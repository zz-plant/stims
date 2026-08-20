// Cmd+K command palette. This component does NOT bind the global Cmd+K —
// App owns that. Wiring (all in App.tsx, no changes needed here):
//
//   import { CommandPalette, useCommandPaletteHotkey } from './CommandPalette.tsx';
//   import type { CommandAction } from './command-palette-registry.ts';
//
//   const [paletteOpen, setPaletteOpen] = useState(false);
//   useCommandPaletteHotkey(() => setPaletteOpen(true));   // binds Cmd/Ctrl+K
//   // The chord itself lives in shortcut-registry.ts under 'palette', so it
//   // is listed in the shortcuts dialog and can be rebound there.
//
//   const paletteActions: CommandAction[] = useMemo(() => [
//     { id: 'open-browse', label: 'Browse presets', shortcutHint: 'B',
//       run: () => updatePanel('browse') },
//     { id: 'next-preset', label: 'Next preset (random)', shortcutHint: 'N',
//       keywords: ['shuffle'], run: engine.handleShufflePreset },
//     { id: 'transition-1s', label: 'Transition: 1s blend',
//       run: () => setTransitionSeconds(1) },
//     // ...panels, save, fullscreen, share, stop audio, audio sources, etc.
//   ], [/* handler deps */]);
//
//   <CommandPalette
//     open={paletteOpen}
//     onClose={() => setPaletteOpen(false)}
//     actions={paletteActions}
//     presets={filteredCatalog.map((e) => ({ id: e.id, title: e.title, author: e.author }))}
//     // or searchPresets={(q) => catalogSearch(q)} for an indexed source
//     onSelectPreset={handlePresetSelection}
//   />

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import styles from '../../css/CommandPalette.module.css';
import {
  buildPaletteResults,
  type CommandAction,
  DEFAULT_PALETTE_LIMIT,
  type PalettePresetResult,
  type PaletteResult,
} from './command-palette-registry.ts';
import { useFocusTrap } from './hooks/use-focus-trap.ts';
import {
  eventMatchesShortcut,
  readShortcutOverrides,
  type ShortcutOverrides,
  shortcutHintFor,
} from './shortcut-registry.ts';

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  /** Runnable commands. Empty query shows these (in the given order). */
  actions: CommandAction[];
  /** Static preset source. Ignored when searchPresets is provided. */
  presets?: PalettePresetResult[];
  /** Callback preset source, e.g. an indexed search. Wins over presets. */
  searchPresets?: (query: string) => PalettePresetResult[];
  /** Invoked when a preset result is chosen. */
  onSelectPreset?: (presetId: string) => void;
  /** Cap on visible results. Default 12. */
  maxResults?: number;
};

const USE_COUNT_STORAGE_KEY = 'stims:palette-frecency:v1';
const USE_COUNT_LIMIT = 200;

function readPaletteUseCounts(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(USE_COUNT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

function recordPaletteUse(resultId: string): void {
  try {
    const counts = readPaletteUseCounts();
    counts[resultId] = (counts[resultId] ?? 0) + 1;
    // Bounded: keep the most-used entries so the blob can't grow forever
    // (preset ids alone number in the thousands).
    const entries = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, USE_COUNT_LIMIT);
    window.localStorage.setItem(
      USE_COUNT_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // Private mode / quota — frecency just doesn't accumulate.
  }
}

function optionDomId(index: number) {
  return `stims-cmdk-option-${index}`;
}

export function CommandPalette({
  open,
  onClose,
  actions,
  presets,
  searchPresets,
  onSelectPreset,
  maxResults = DEFAULT_PALETTE_LIMIT,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // Re-read on each open so a rebind made in the shortcuts dialog shows up
  // the next time the palette is used, without this component subscribing to
  // storage.
  const [overrides, setOverrides] = useState<ShortcutOverrides>({});
  useEffect(() => {
    if (open) setOverrides(readShortcutOverrides());
  }, [open]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Focus lands on the input on open and returns to the previously focused
  // element on close (useFocusTrap snapshots document.activeElement).
  const containerRef = useFocusTrap<HTMLDivElement>({
    active: open,
    autoFocus: true,
    restoreFocusOnUnmount: true,
    initialFocusRef: inputRef,
  });

  // Fresh palette each open; keyed on `open` so a reopened palette never
  // flashes the previous session's query/highlight.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  // Frecency: bounded boost from per-result use counts, so repeat workflows
  // surface within a character or two. Read once per open — a palette
  // session's own runs shouldn't reshuffle the list mid-flight.
  const useCounts = useMemo(() => (open ? readPaletteUseCounts() : {}), [open]);

  const results: PaletteResult[] = useMemo(
    () =>
      buildPaletteResults({
        query,
        actions,
        presets,
        searchPresets,
        limit: maxResults,
        useCounts,
      }),
    [query, actions, presets, searchPresets, maxResults, useCounts],
  );

  // Clamp the highlight when the result list shrinks under it.
  const highlightIndex = Math.min(activeIndex, Math.max(0, results.length - 1));

  useEffect(() => {
    const option = listRef.current?.querySelector<HTMLElement>(
      `#${optionDomId(highlightIndex)}`,
    );
    option?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex]);

  if (!open) return null;

  const runResult = (result: PaletteResult) => {
    recordPaletteUse(result.id);
    // Close first so a command that opens another dialog isn't fighting this
    // one's focus trap/restore for the same tick.
    onClose();
    if (result.kind === 'action') {
      result.action.run();
    } else {
      onSelectPreset?.(result.preset.id);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (results.length > 0) {
          setActiveIndex((highlightIndex + 1) % results.length);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (results.length > 0) {
          setActiveIndex(
            (highlightIndex - 1 + results.length) % results.length,
          );
        }
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(Math.max(0, results.length - 1));
        break;
      case 'Enter': {
        event.preventDefault();
        const result = results[highlightIndex];
        if (result) runResult(result);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          // Keep it from also reaching any global Escape/close handling —
          // one press dismisses the palette only.
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: card is visual-only; the backdrop handles dismiss */}
      <div
        ref={containerRef}
        className={styles.card}
        onClick={(event) => event.stopPropagation()}
        role="presentation"
      >
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder="Search actions and presets…"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          // aria-activedescendant keeps DOM focus in the input while arrows
          // move the highlighted option — the listbox pattern for combo
          // inputs, so typing never has to re-target.
          role="combobox"
          aria-expanded="true"
          aria-controls="stims-cmdk-listbox"
          aria-activedescendant={
            results.length > 0 ? optionDomId(highlightIndex) : undefined
          }
          aria-label="Search actions and presets"
        />
        <div
          ref={listRef}
          id="stims-cmdk-listbox"
          className={styles.list}
          role="listbox"
          aria-label="Command results"
        >
          {results.length === 0 ? (
            <p className={styles.empty}>No matches</p>
          ) : (
            results.map((result, index) => {
              // Section headings, only in the unfiltered list. They are
              // siblings of the options rather than wrappers, and carry
              // role="presentation", so option indices — which drive
              // optionDomId/aria-activedescendant — stay untouched.
              const group =
                result.kind === 'action' ? result.action.group : undefined;
              const previous = results[index - 1];
              const previousGroup =
                previous?.kind === 'action' ? previous.action.group : undefined;
              const heading =
                query.trim() === '' && group && group !== previousGroup ? (
                  <div
                    key={`group-${group}`}
                    className={styles.groupLabel}
                    role="presentation"
                  >
                    {group}
                  </div>
                ) : null;
              return (
                <Fragment key={result.id}>
                  {heading}
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation happens via Enter on the combobox input (aria-activedescendant pattern) */}
                  <div
                    id={optionDomId(index)}
                    className={styles.option}
                    role="option"
                    aria-selected={index === highlightIndex}
                    // Programmatically focusable only; DOM focus stays on the
                    // input (aria-activedescendant drives the highlight).
                    tabIndex={-1}
                    onMouseEnter={() => setActiveIndex(index)}
                    // mousedown would steal focus from the input before click
                    // lands; suppress it so the palette stays typeable even
                    // after a misclick that doesn't complete.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => runResult(result)}
                  >
                    {result.kind === 'action' ? (
                      <>
                        <span className={styles.optionLabel}>
                          {result.action.label}
                        </span>
                        {(() => {
                          // Derived, not read off the action: an explicit
                          // shortcutHint stays authoritative for actions with
                          // no registry binding, but anything bound resolves
                          // through the registry so a rebind is reflected here
                          // instead of advertising the old key.
                          const hint =
                            shortcutHintFor(result.action.id, overrides) ??
                            result.action.shortcutHint;
                          return hint ? (
                            <kbd className={styles.optionHint}>{hint}</kbd>
                          ) : null;
                        })()}
                      </>
                    ) : (
                      <>
                        <span className={styles.optionLabel}>
                          {result.preset.title}
                        </span>
                        <span className={styles.optionMeta}>
                          {result.preset.author
                            ? `Preset · ${result.preset.author}`
                            : 'Preset'}
                        </span>
                      </>
                    )}
                  </div>
                </Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Opens the palette on the chord registered as 'palette' in
 * shortcut-registry.ts — Cmd+K (macOS) / Ctrl+K by default, and rebindable
 * from the shortcuts dialog like any other binding.
 */
export function useCommandPaletteHotkey(onOpen: () => void) {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Matched through the registry so the chord has one definition, and so
      // the help dialog lists it rather than it being folded into this file.
      if (eventMatchesShortcut(event, 'palette', readShortcutOverrides())) {
        event.preventDefault();
        onOpenRef.current();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
