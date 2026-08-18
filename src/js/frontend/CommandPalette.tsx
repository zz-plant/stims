// Cmd+K command palette. This component does NOT bind the global Cmd+K —
// App owns that. Wiring (all in App.tsx, no changes needed here):
//
//   import { CommandPalette, useCommandPaletteHotkey } from './CommandPalette.tsx';
//   import type { CommandAction } from './command-palette-registry.ts';
//
//   const [paletteOpen, setPaletteOpen] = useState(false);
//   useCommandPaletteHotkey(() => setPaletteOpen(true));   // binds Cmd/Ctrl+K
//   // ...or instead register 'k' in shortcut-registry.ts and open it from
//   // useKeyboardShortcuts like the other panels, if a rebindable shortcut
//   // is wanted — the hook is just the zero-config path.
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

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from '../../css/CommandPalette.module.css';
import {
  buildPaletteResults,
  type CommandAction,
  DEFAULT_PALETTE_LIMIT,
  type PalettePresetResult,
  type PaletteResult,
} from './command-palette-registry.ts';
import { useFocusTrap } from './hooks/use-focus-trap.ts';

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

  const results: PaletteResult[] = useMemo(
    () =>
      buildPaletteResults({
        query,
        actions,
        presets,
        searchPresets,
        limit: maxResults,
      }),
    [query, actions, presets, searchPresets, maxResults],
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
            results.map((result, index) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation happens via Enter on the combobox input (aria-activedescendant pattern)
              <div
                key={result.id}
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
                    {result.action.shortcutHint ? (
                      <kbd className={styles.optionHint}>
                        {result.action.shortcutHint}
                      </kbd>
                    ) : null}
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Optional zero-config opener: binds Cmd+K (macOS) / Ctrl+K to `onOpen` on
 * document. App can use this, or skip it and register the key through
 * shortcut-registry.ts if it should be user-rebindable.
 */
export function useCommandPaletteHotkey(onOpen: () => void) {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        onOpenRef.current();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
