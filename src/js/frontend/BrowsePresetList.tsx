/**
 * Browse Preset List — the Browse panel's virtualized list view: the
 * TanStack virtualizer, the rows it windows, and the roving keyboard focus
 * that has to reach rows which are not rendered yet.
 *
 * Left uncompiled by React Compiler on purpose: `useVirtualizer()` returns
 * functions the compiler cannot memoize safely, so it skips this component.
 * It lives apart from BrowseSheetPanel so that the panel compiles.
 */

import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { splitPresetDisplay } from '../milkdrop/preset-credit.ts';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import { PresetLineageSection } from './PresetLineageSection.tsx';
import { PresetSignals } from './PresetSignals.tsx';
import { openPresetInPlace, presetPageHref } from './preset-link.ts';
import { runPresetPromoteTransition } from './promote-transition.ts';
import { quickSelectDigit } from './quick-select.ts';
import { describePresetMood } from './workspace-helpers.ts';

// Measured rendered row height (52px content) plus the 2px gap the old
// `.ctl-presets { gap: 2px }` used to provide for free — absolutely
// positioned virtualized rows ignore CSS gap, so each row's own box is
// rendered PRESET_ROW_HEIGHT - PRESET_ROW_GAP tall to reproduce it.
const PRESET_ROW_HEIGHT = 54;
const PRESET_ROW_GAP = 2;
const PRESET_ROW_OVERSCAN = 8;

/**
 * Mounted for as long as the Browse panel is, and draws nothing while the
 * grid is showing or nothing matches. Keeping it mounted keeps one
 * virtualizer for the panel's whole life, as when it lived in the panel: the
 * virtualizer remembers its offset while its scroll element is gone, so a
 * toggle back from the grid lands where the list was left, and the roving
 * row survives the toggle.
 */
export function BrowsePresetList({
  visible,
  entries,
  catalog,
  currentPresetId,
  presetPreviews,
  queuedPresetIdSet,
  showQuickSelectKeys,
  filterEpoch,
  readInitialScrollTop,
  onScrollTopChange,
  onSelect,
  onToggleQueued,
  onToggleFavorite,
}: {
  /** List view is on and at least one preset matches. */
  visible: boolean;
  /** The filtered, sorted result set. */
  entries: PresetCatalogEntry[];
  /** The whole catalog, for the lineage cards above the rows. */
  catalog: PresetCatalogEntry[];
  currentPresetId: string | null;
  presetPreviews: Record<string, MilkdropPresetRenderPreview>;
  queuedPresetIdSet: ReadonlySet<string>;
  showQuickSelectKeys: boolean;
  /** Bumped by the panel when filters change: return to the top. */
  filterEpoch: number;
  /** The offset this view was left at, read once on mount. */
  readInitialScrollTop: () => number;
  onScrollTopChange: (top: number) => void;
  onSelect: (presetId: string) => void;
  onToggleQueued: (entry: PresetCatalogEntry) => void;
  onToggleFavorite: (entry: PresetCatalogEntry) => void;
}) {
  const presetListRef = useRef<HTMLUListElement | null>(null);
  const presetScrollRef = useRef<HTMLDivElement | null>(null);
  const lineageWrapperRef = useRef<HTMLDivElement | null>(null);
  const [lineageHeight, setLineageHeight] = useState(0);

  // The list is virtualized (see rowVirtualizer below), so only a small
  // window of rows exists as real DOM nodes at any time — the roving
  // tabindex + DOM-querying pattern useListKeyboardNav uses for the other
  // lists on this panel can't see rows that aren't currently rendered.
  // rovingIndex is this list's own analog: the single index that owns
  // tabIndex 0 (everything else rendered gets -1), moved by explicit
  // index arithmetic on keydown instead of by walking DOM children.
  const activeIndex = useMemo(
    () => entries.findIndex((entry) => entry.id === currentPresetId),
    [entries, currentPresetId],
  );
  const [rovingIndex, setRovingIndex] = useState(0);
  const pendingFocusIndexRef = useRef<number | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => presetScrollRef.current,
    estimateSize: () => PRESET_ROW_HEIGHT,
    overscan: PRESET_ROW_OVERSCAN,
    scrollMargin: lineageHeight,
  });

  // The lineage section (family/lineage cards) renders above the virtual
  // list but inside the same scroll container, so its height has to be fed
  // back into the virtualizer as scrollMargin — otherwise row offsets would
  // assume the list starts at the scroll container's top instead of below
  // the lineage block. Its content changes with the catalog/filters, so a
  // ResizeObserver keeps this in sync rather than a one-shot measurement.
  // `visible` is a real dependency despite not being read in the body: it's
  // what mounts/unmounts lineageWrapperRef's node, so the effect must re-run
  // to (re)attach the observer to the node that is actually on screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useLayoutEffect(() => {
    const node = lineageWrapperRef.current;
    if (!node) {
      setLineageHeight(0);
      return;
    }
    const observer = new ResizeObserver((observed) => {
      const entry = observed[0];
      if (entry) setLineageHeight(entry.contentRect.height);
    });
    observer.observe(node);
    setLineageHeight(node.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [visible]);

  // Re-seed the roving position and scroll it into view whenever the active
  // preset changes (initial open, or selected some other way — a route
  // change, autoplay). Deliberately not reactive to `rovingIndex`, `entries`,
  // or `activeIndex` themselves: `rovingIndex` is driven by the user's own
  // arrow-key moves and must not be fought by this effect re-centering on
  // every keypress, and `entries`/`activeIndex` change on every keystroke of
  // a search — this should only re-seed when the *active preset itself*
  // changes, or when a set of results goes from/to empty.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    const target = Math.max(activeIndex, 0);
    setRovingIndex(target);
    if (entries.length > 0) {
      rowVirtualizer.scrollToIndex(target, { align: 'auto' });
    }
  }, [currentPresetId, entries.length === 0]);

  // Applies a keyboard-driven roving-index move once its row has actually
  // rendered — scrollToIndex's resulting range change lands a render after
  // the state update that requests it, so focusing synchronously in the
  // same handler would often miss (the row doesn't exist yet).
  useLayoutEffect(() => {
    const pending = pendingFocusIndexRef.current;
    if (pending === null) return;
    const row = presetListRef.current?.querySelector<HTMLElement>(
      `[data-preset-index="${pending}"] .ctl-preset__open`,
    );
    if (row) {
      row.focus();
      pendingFocusIndexRef.current = null;
    }
  });

  const handlePresetListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      if (entries.length === 0) return;
      const active = document.activeElement;
      const activeItem =
        active instanceof HTMLElement
          ? active.closest<HTMLElement>('[data-preset-index]')
          : null;
      // Focus is on something else inside the container (e.g. a favorite
      // button) — arrow keys fall through to default behavior rather than
      // guessing which row "owns" it, matching useListKeyboardNav.
      if (!activeItem) return;
      const currentIndex = Number(activeItem.dataset.presetIndex);

      let nextIndex = -1;
      switch (event.key) {
        case 'ArrowDown':
          nextIndex = currentIndex + 1;
          break;
        case 'ArrowUp':
          nextIndex = currentIndex - 1;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = entries.length - 1;
          break;
        default:
          return;
      }
      if (nextIndex < 0 || nextIndex >= entries.length) return;
      event.preventDefault();
      event.stopPropagation();
      pendingFocusIndexRef.current = nextIndex;
      setRovingIndex(nextIndex);
      rowVirtualizer.scrollToIndex(nextIndex, { align: 'auto' });
    },
    [entries.length, rowVirtualizer],
  );

  // Filters changed: jump back to the top — mirrors the old pagination reset
  // (a fresh filter previously meant "start from batch one again");
  // scrollToIndex needs a guard for an empty result set. Skips mount so it
  // cannot stomp the remembered offset restored below.
  const filterEpochSettledRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: filterEpoch is a change signal, not a value read in the body
  useEffect(() => {
    if (!filterEpochSettledRef.current) {
      filterEpochSettledRef.current = true;
      return;
    }
    if (entries.length > 0) {
      rowVirtualizer.scrollToIndex(0, { align: 'start' });
    }
  }, [filterEpoch]);

  // Restore the list's remembered offset on mount (panel reopen). Deferred
  // past the commit for the same reason the grid defers its jumps: a scroll
  // event landing while React renders collides with the virtualizer's
  // flushSync and leaves it wedged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only restore
  useEffect(() => {
    const element = presetScrollRef.current;
    const saved = readInitialScrollTop();
    if (!element || saved <= 0) return;
    const timer = window.setTimeout(() => {
      element.scrollTop = saved;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    // Virtualized: only the rows within the scroll viewport (plus
    // PRESET_ROW_OVERSCAN on each side) exist as real DOM nodes,
    // regardless of how many presets match the current filter — see
    // handlePresetListKeyDown above for how arrow/Home/End nav still
    // reaches rows that aren't currently rendered.
    <div
      ref={presetScrollRef}
      className="ctl-presets-scroll"
      // Reported on every scroll frame; the panel keeps it in module scope,
      // never in state: a re-render per frame would undo the virtualization
      // it is riding on.
      onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
    >
      {/* The lineage section scrolls WITH the list (matching its old
          position in normal document flow before virtualization)
          rather than sitting fixed above it. Its height varies with
          content, so the virtualizer needs scrollMargin kept in sync
          via the ResizeObserver above — otherwise its virtual-row
          offsets would assume the list starts right at the scroll
          container's top. */}
      <div ref={lineageWrapperRef}>
        <PresetLineageSection
          catalog={catalog}
          currentPresetId={currentPresetId}
          onSelect={onSelect}
        />
      </div>
      <ul
        ref={presetListRef}
        className="ctl-presets"
        onKeyDown={handlePresetListKeyDown}
        style={{
          // getTotalSize() includes scrollMargin (the lineage block's
          // height, reserved above the rows) — the lineage block
          // already occupies that space in normal flow via
          // lineageWrapperRef above, so it must be subtracted here or
          // the rows would get scrollMargin worth of extra blank
          // space stacked on top of them too.
          height:
            rowVirtualizer.getTotalSize() - rowVirtualizer.options.scrollMargin,
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const entry = entries[virtualRow.index];
          if (!entry) return null;
          // Titles carry the author chain inline, so the byline would
          // otherwise repeat it verbatim on the line below.
          const display = splitPresetDisplay(entry.title, entry.author);
          return (
            <li
              key={entry.id}
              data-preset-index={virtualRow.index}
              className="ctl-preset"
              data-active={String(entry.id === currentPresetId)}
              // Only ~15 <li> exist at a time; without these a screen
              // reader announces "list, 15 items" for the full result
              // set however large it actually is.
              aria-setsize={entries.length}
              aria-posinset={virtualRow.index + 1}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size - PRESET_ROW_GAP,
                transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
              }}
            >
              {/* A link to the preset's page, like the grid tiles:
                  crawlable, and openable in a new tab. */}
              <a
                href={presetPageHref(entry.id)}
                className="ctl-preset__open"
                tabIndex={virtualRow.index === rovingIndex ? 0 : -1}
                aria-current={entry.id === currentPresetId ? 'true' : undefined}
                aria-keyshortcuts={
                  showQuickSelectKeys
                    ? (quickSelectDigit(virtualRow.index) ?? undefined)
                    : undefined
                }
                onClick={(event) =>
                  openPresetInPlace(event, () => {
                    setRovingIndex(virtualRow.index);
                    runPresetPromoteTransition({
                      sourceElement: event.currentTarget,
                      presetId: entry.id,
                    });
                    onSelect(entry.id);
                  })
                }
              >
                <span className="ctl-preset__art">
                  <PresetArtwork
                    entry={entry}
                    compact
                    preview={presetPreviews[entry.id] ?? null}
                  />
                  {showQuickSelectKeys && quickSelectDigit(virtualRow.index) ? (
                    <span className="ctl-preset__quick-key" aria-hidden="true">
                      {quickSelectDigit(virtualRow.index)}
                    </span>
                  ) : null}
                </span>
                <span className="ctl-preset__copy">
                  <span className="ctl-preset__title">{display.title}</span>
                  {/* The credit, not a mood. describePresetMood
                      keyword-matches the title to guess a vibe and
                      falls back to "Instant pick", which is not a
                      mood at all — so the one metadata line each row
                      gets was spent restating the title in vaguer
                      words, right next to the title. The author is
                      real, cited metadata and is how people actually
                      navigate this catalog (Geiss, Rovastar, Flexi).
                      The mood still earns its keep in PresetArtwork,
                      where it stands in for a missing thumbnail. */}
                  <span className="ctl-preset__meta">
                    {display.byline ?? describePresetMood(entry)}
                    {/* Inline with the credit, not on its own line:
                        the virtualizer measures rows at a fixed
                        PRESET_ROW_HEIGHT, so a third line overflows
                        and each chip crowds the next row's title. */}
                    <PresetSignals entry={entry} />
                  </span>
                </span>
              </a>
              <button
                type="button"
                className="ctl-preset__queue"
                data-queued={String(queuedPresetIdSet.has(entry.id))}
                aria-label={
                  queuedPresetIdSet.has(entry.id)
                    ? `Remove ${entry.title} from the queue`
                    : `Queue ${entry.title}`
                }
                title={
                  queuedPresetIdSet.has(entry.id)
                    ? 'Remove from queue'
                    : 'Add to queue'
                }
                aria-pressed={queuedPresetIdSet.has(entry.id)}
                onClick={() => onToggleQueued(entry)}
              >
                <span className="ctl-preset__queue-icon" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ctl-preset__fav"
                data-saved={String(Boolean(entry.isFavorite))}
                aria-label={
                  entry.isFavorite
                    ? `Remove ${entry.title} from saved`
                    : `Save ${entry.title}`
                }
                title={entry.isFavorite ? 'Remove from saved' : 'Save preset'}
                aria-pressed={Boolean(entry.isFavorite)}
                onClick={() => onToggleFavorite(entry)}
              >
                <span className="ctl-preset__fav-icon" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
