import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  getActiveAccessibilityPreference,
  setAccessibilityPreference,
  subscribeToAccessibilityPreference,
} from '../core/accessibility-preferences.ts';
import { splitPresetDisplay } from '../milkdrop/preset-credit.ts';
import type { AudioSource, PresetCatalogEntry } from './contracts.ts';
import { useListKeyboardNav } from './hooks/use-list-keyboard-nav.ts';
import { useScrollerOverflow } from './hooks/use-scroller-overflow.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import { PresetGrid } from './PresetGrid.tsx';
import { PresetLineageSection } from './PresetLineageSection.tsx';
import { PresetSignals } from './PresetSignals.tsx';
import { runPresetPromoteTransition } from './promote-transition.ts';
import { SkeletonPresetCard } from './SkeletonPresetCard.tsx';
import { writeStored } from './safe-storage.ts';
import { UiIcon } from './UiIcon.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';
import {
  type BrowseSortMode,
  buildAppliedFilterSummary,
  createFieldMatcher,
  describePresetMood,
  getAuthorOptions,
  getCollectionCounts,
  getFeaturedCollectionTags,
  matchesAuthor,
  matchesPreset,
  passesFlashPreference,
  prettifyCollectionTag,
  sortBrowseEntries,
  sortCollectionsBySelectivity,
} from './workspace-helpers.ts';

export {
  type ImageToPresetAction,
  type ImageToPresetResponse,
  resolveImageToPresetAction,
} from './workspace-helpers.ts';

type SortMode = BrowseSortMode;

// Measured rendered row height (52px content) plus the 2px gap the old
// `.ctl-presets { gap: 2px }` used to provide for free — absolutely
// positioned virtualized rows ignore CSS gap, so each row's own box is
// rendered PRESET_ROW_HEIGHT - PRESET_ROW_GAP tall to reproduce it.
const PRESET_ROW_HEIGHT = 54;
const PRESET_ROW_GAP = 2;
const PRESET_ROW_OVERSCAN = 8;

/**
 * Where each view was left, so toggling grid/list or reopening the panel
 * does not dump you back at the top of ~2,700 results.
 *
 * Module scope rather than a ref: BrowseSheetPanel unmounts when the panel
 * closes, so anything held in component state dies with it. Per view because
 * the two have completely different offsets for the same position in the
 * result set. Deliberately NOT persisted across reloads — a remembered
 * offset into a catalog that may have changed is worse than starting fresh.
 */
const browseScrollMemory: { grid: number; list: number } = { grid: 0, list: 0 };

function readSortMode(): SortMode {
  try {
    return (
      (localStorage.getItem('stims:browse-sort') as SortMode) ?? 'relevance'
    );
  } catch {
    return 'relevance';
  }
}

/**
 * Grid is the default: presets are picked by how they look, and the 54px list
 * row can only show a thumbnail too small to judge. The list view stays for
 * scanning a long catalog by name.
 */
function readGridView(): boolean {
  try {
    return (localStorage.getItem('stims:browse-view') ?? 'grid') === 'grid';
  } catch {
    return true;
  }
}

export function BrowseSheetPanel({
  onCollectionTagChange,
  onImport,
  offline = false,
  sessionHistory = [],
}: {
  onCollectionTagChange: (tag: string | null) => void;
  onImport: (files: FileList | File[] | null) => void;
  offline?: boolean;
  sessionHistory?: Array<{ presetId: string; title: string; at: number }>;
}) {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const catalog = engine.catalog;
  const catalogError = engine.catalogError;
  const catalogReady = engine.catalogReady;
  const collectionTags = engine.collectionTags;
  const currentPresetId = engineSnapshot?.activePresetId ?? null;
  const presetPreviews = engine.presetPreviews;
  const routeState = ui.routeState;
  const searchQuery = ui.searchQuery;

  const [sortMode, setSortMode] = useState<SortMode>(readSortMode);
  const [randomSeed, setRandomSeed] = useState(() => Date.now());
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const deferredSearch = useDeferredValue(localSearch);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [gridView, setGridView] = useState(readGridView);
  const resultsRef = useRef<HTMLElement | null>(null);

  // Wrapper for PresetGrid — only passes presetId and audioSource
  const setPresetRouteState = (next: {
    presetId: string | null;
    audioSource: AudioSource | null;
  }) => {
    ui.commitRoute({
      ...ui.routeState,
      ...next,
    });
  };
  const setView = (next: boolean) => {
    setGridView(next);
    // Private-mode storage failure just means the choice is session-only;
    // the toggle still works. writeStored already swallows that.
    writeStored('stims:browse-view', next ? 'grid' : 'list');
  };
  const clearFilters = () => {
    setLocalSearch('');
    ui.setSearchQuery('');
    onCollectionTagChange(null);
    setAuthorFilter(null);
  };
  const presetListRef = useRef<HTMLUListElement | null>(null);
  const presetScrollRef = useRef<HTMLDivElement | null>(null);
  const lineageWrapperRef = useRef<HTMLDivElement | null>(null);
  const [lineageHeight, setLineageHeight] = useState(0);
  const recentRailRef = useRef<HTMLUListElement | null>(null);
  const collectionChipsRef = useRef<HTMLElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const authorOptions = useMemo(() => getAuthorOptions(catalog), [catalog]);

  // Synchronize local search state when global searchQuery is modified externally (e.g. clear filters)
  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  // Debounce sync from localSearch to global searchQuery. This does NOT gate
  // the visible filter — `deferredSearch` (useDeferredValue above) already
  // keeps the list responsive to every keystroke at React's own pace. This
  // timer only paces writes to the global route/URL state, so typing fast
  // doesn't thrash history/URL updates; 80ms (was 150ms, uncommented) is
  // still comfortably above a keystroke's cadence for that purpose alone.
  useEffect(() => {
    if (localSearch === searchQuery) return;
    const timer = setTimeout(() => {
      ui.setSearchQuery(localSearch);
    }, 80);
    return () => clearTimeout(timer);
  }, [localSearch, searchQuery, ui]);

  const collectionCounts = useMemo(
    () => getCollectionCounts(catalog),
    [catalog],
  );
  const featuredTags = useMemo(
    () =>
      sortCollectionsBySelectivity(
        getFeaturedCollectionTags(collectionTags),
        collectionCounts,
      ),
    [collectionTags, collectionCounts],
  );
  const hasFilter =
    localSearch.trim().length > 0 ||
    routeState.collectionTag !== null ||
    authorFilter !== null;

  // Live-read so flipping "Reduce flashing" in Settings re-filters the open
  // sheet rather than waiting for a reload.
  const reduceFlashing = useSyncExternalStore(
    subscribeToAccessibilityPreference,
    () => getActiveAccessibilityPreference().reduceFlashing,
    () => false,
  );

  const browseEntries = useMemo(() => {
    const matcher = deferredSearch
      ? createFieldMatcher(deferredSearch, { allowSubsequence: false })
      : null;
    return catalog.filter((entry) => {
      if (
        routeState.collectionTag &&
        routeState.collectionTag !== 'collection:community' &&
        !entry.tags?.includes(routeState.collectionTag)
      ) {
        return false;
      }
      return (
        passesFlashPreference(entry, reduceFlashing) &&
        (matcher ? matchesPreset(entry, matcher) : true) &&
        matchesAuthor(entry, authorFilter)
      );
    });
  }, [
    catalog,
    routeState.collectionTag,
    deferredSearch,
    authorFilter,
    reduceFlashing,
  ]);

  const sorted = useMemo(
    () => sortBrowseEntries(browseEntries, sortMode, randomSeed),
    [browseEntries, sortMode, randomSeed],
  );

  /**
   * How many presets "Reduce flashing" is holding back.
   *
   * This preference defaults to ON whenever the OS reports reduced-motion,
   * so it is routinely on without ever having been chosen — and unlike the
   * search and author filters it is invisible here, has no chip, and is not
   * touched by "Clear filters". The result was a library quietly missing
   * presets with nothing on screen accounting for them.
   */
  const flashHiddenCount = useMemo(() => {
    if (!reduceFlashing) return 0;
    return catalog.filter((entry) => !passesFlashPreference(entry, true))
      .length;
  }, [catalog, reduceFlashing]);

  // The list is virtualized (see rowVirtualizer below), so only a small
  // window of rows exists as real DOM nodes at any time — the roving
  // tabindex + DOM-querying pattern useListKeyboardNav uses for the other
  // lists on this panel can't see rows that aren't currently rendered.
  // rovingIndex is this list's own analog: the single index that owns
  // tabIndex 0 (everything else rendered gets -1), moved by explicit
  // index arithmetic on keydown instead of by walking DOM children.
  const activeIndex = useMemo(
    () => sorted.findIndex((entry) => entry.id === currentPresetId),
    [sorted, currentPresetId],
  );
  const [rovingIndex, setRovingIndex] = useState(0);
  const pendingFocusIndexRef = useRef<number | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
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
  // gridView is a real dependency despite not being read in the body: it's
  // what mounts/unmounts lineageWrapperRef's node (only rendered in list
  // view), so the effect must re-run on toggle to (re)attach the observer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useLayoutEffect(() => {
    const node = lineageWrapperRef.current;
    if (!node) {
      setLineageHeight(0);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setLineageHeight(entry.contentRect.height);
    });
    observer.observe(node);
    setLineageHeight(node.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [gridView]);

  // Re-seed the roving position and scroll it into view whenever the active
  // preset changes (initial open, or selected some other way — a route
  // change, autoplay). Deliberately not reactive to `rovingIndex`, `sorted`,
  // or `activeIndex` themselves: `rovingIndex` is driven by the user's own
  // arrow-key moves and must not be fought by this effect re-centering on
  // every keypress, and `sorted`/`activeIndex` change on every keystroke of
  // a search — this should only re-seed when the *active preset itself*
  // changes, or when a set of results goes from/to empty.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    const target = activeIndex >= 0 ? activeIndex : 0;
    setRovingIndex(target);
    if (sorted.length > 0) {
      rowVirtualizer.scrollToIndex(target, { align: 'auto' });
    }
  }, [currentPresetId, sorted.length === 0]);

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
      if (sorted.length === 0) return;
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
          nextIndex = sorted.length - 1;
          break;
        default:
          return;
      }
      if (nextIndex < 0 || nextIndex >= sorted.length) return;
      event.preventDefault();
      event.stopPropagation();
      pendingFocusIndexRef.current = nextIndex;
      setRovingIndex(nextIndex);
      rowVirtualizer.scrollToIndex(nextIndex, { align: 'auto' });
    },
    [sorted.length, rowVirtualizer],
  );

  useListKeyboardNav(recentRailRef, {
    itemSelector: '.ctl-recent-rail__item',
    orientation: 'horizontal',
  });
  useListKeyboardNav(collectionChipsRef, {
    itemSelector: '.ctl-chip',
    orientation: 'horizontal',
    deps: [featuredTags.length],
  });
  // Both rails hide their scrollbars, so the edge fade is the only signal
  // that they scroll at all — the chips hide roughly three screens of
  // filters at phone widths.
  useScrollerOverflow(collectionChipsRef, [featuredTags.length, offline]);
  useScrollerOverflow(recentRailRef, [sessionHistory.length]);

  // This-session rail: distinct from the "Recently opened" sort mode, which
  // reads persisted lastOpenedAt across sessions. sessionHistory is in-memory
  // only, so this is "what you just looked at", good for flicking back a
  // couple of steps without losing your place in the filtered list below.
  const recentEntries = useMemo(() => {
    const seen = new Set<string>();
    const entries: PresetCatalogEntry[] = [];
    for (const record of sessionHistory) {
      if (record.presetId === currentPresetId || seen.has(record.presetId)) {
        continue;
      }
      const entry = catalog.find((item) => item.id === record.presetId);
      if (!entry) {
        continue;
      }
      seen.add(record.presetId);
      entries.push(entry);
      if (entries.length >= 8) {
        break;
      }
    }
    return entries;
  }, [sessionHistory, catalog, currentPresetId]);

  // Jump the virtualized list back to the top when filters change — mirrors
  // the old pagination reset (a fresh filter previously meant "start from
  // batch one again"); scrollToIndex needs a guard for an empty result set.
  //
  // The mount run is skipped so it cannot stomp the remembered offset being
  // restored below: this effect's deps are all filter values, which "change"
  // once on mount by definition. `filterEpoch` lets the grid — which owns
  // its own scroll element — reset in step without having to work out for
  // itself whether a new entry list came from a filter or a re-sort.
  const filterSettledRef = useRef(false);
  const [filterEpoch, setFilterEpoch] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll-to-top on filter changes specifically, not sorted identity
  useEffect(() => {
    if (!filterSettledRef.current) {
      filterSettledRef.current = true;
      return;
    }
    // A remembered offset into the previous result set means nothing once
    // the set changes.
    browseScrollMemory.list = 0;
    browseScrollMemory.grid = 0;
    setFilterEpoch((epoch) => epoch + 1);
    if (sorted.length > 0) {
      rowVirtualizer.scrollToIndex(0, { align: 'start' });
    }
  }, [searchQuery, routeState.collectionTag, authorFilter]);

  // Restore the list's remembered offset on mount (panel reopen, or a
  // toggle back from grid). Deferred past the commit for the same reason
  // the grid defers its jumps: a scroll event landing while React renders
  // collides with the virtualizer's flushSync and leaves it wedged.
  useEffect(() => {
    const element = presetScrollRef.current;
    const saved = browseScrollMemory.list;
    if (!element || saved <= 0) return;
    const timer = window.setTimeout(() => {
      element.scrollTop = saved;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      className="stims-shell__sheet-panel stims-shell__sheet-panel--browse"
      data-filter-active={String(hasFilter)}
      // Scopes the bounded-flex-column layout the virtualized list needs
      // (see chrome.css's [data-fill="true"] rules) to list view only.
      // Grid view keeps the panel's original page-level scroll — it
      // already relies on content-visibility rather than virtualization
      // and was never part of this change.
      data-view={gridView ? 'grid' : 'list'}
    >
      <section className="ctl-browse-filters">
        <div className="ctl-browse-searchrow">
          <input
            id="preset-search"
            className="ctl-field"
            type="search"
            placeholder="Search presets"
            aria-label="Search presets"
            spellCheck={false}
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                ui.setSearchQuery(localSearch);
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape' && localSearch !== '') {
                // First Escape clears the query; a second press (now that
                // the field is already empty) falls through to bubble up
                // to SidePanel's own Escape handler and close the panel.
                // Without stopping propagation here, one Escape press would
                // both wipe what you typed AND close the panel in the same
                // keystroke.
                e.stopPropagation();
                setLocalSearch('');
                ui.setSearchQuery('');
              }
            }}
          />
          <button
            type="button"
            className="ctl-btn ctl-btn--icon"
            onClick={engine.handleShufflePreset}
            disabled={catalog.length === 0}
            aria-label="Shuffle presets"
            title="Shuffle presets"
          >
            <UiIcon
              name="shuffle"
              className="stims-icon-slot stims-icon-slot--sm"
              aria-hidden="true"
            />
          </button>
          {/* A drop zone alone would have been mouse/touch-only — this
              button (and the native file picker behind it) is the
              keyboard/click-operable path, not an afterthought bolted onto
              a drag target. */}
          <button
            type="button"
            className="ctl-btn ctl-btn--icon"
            onClick={async () => {
              if (
                typeof window !== 'undefined' &&
                'showDirectoryPicker' in window
              ) {
                try {
                  const dirHandle = await (
                    window as unknown as {
                      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
                    }
                  ).showDirectoryPicker();
                  const files: File[] = [];
                  for await (const entry of dirHandle.values()) {
                    if (
                      entry.kind === 'file' &&
                      (entry.name.endsWith('.milk') ||
                        entry.name.endsWith('.txt'))
                    ) {
                      const file = await entry.getFile();
                      files.push(file);
                    }
                  }
                  if (files.length > 0) {
                    onImport(files);
                  }
                } catch {
                  // User cancelled directory picker or picker rejected
                }
              } else {
                importInputRef.current?.click();
              }
            }}
            aria-label="Import preset file or folder"
            title="Import preset file or folder (File System Access API)"
          >
            <UiIcon
              name="upload"
              className="stims-icon-slot stims-icon-slot--sm"
              aria-hidden="true"
            />
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".milk,text/plain"
            multiple
            hidden
            aria-label="Import preset file"
            onChange={(e) => {
              onImport(e.target.files);
              e.target.value = '';
            }}
          />

          {/* Segmented, not a single chip reading "Grid": that button was
              styled like the collection filters beside it (a different kind
              of control), took a full row for a binary, and labelled itself
              with the CURRENT mode — so clicking the one that said "Grid"
              took you to the list. Two always-visible segments make the
              choice and the current state readable at a glance. */}
          {/* biome-ignore lint/a11y/useSemanticElements: <fieldset> is for form controls and carries min-width:min-content, which misbehaves inside this flex row; role="group" is valid ARIA for a segmented control and keeps the two buttons announced as one */}
          <div
            className="ctl-viewtoggle"
            role="group"
            aria-label="Result layout"
          >
            <button
              type="button"
              className="ctl-viewtoggle__btn"
              data-active={String(gridView)}
              aria-pressed={gridView}
              title="Grid view"
              onClick={() => setView(true)}
            >
              <UiIcon
                name="grid"
                className="stims-icon-slot stims-icon-slot--sm"
                aria-hidden="true"
              />
              <span className="stims-shell__sr-only">Grid view</span>
            </button>
            <button
              type="button"
              className="ctl-viewtoggle__btn"
              data-active={String(!gridView)}
              aria-pressed={!gridView}
              title="List view"
              onClick={() => setView(false)}
            >
              <UiIcon
                name="menu"
                className="stims-icon-slot stims-icon-slot--sm"
                aria-hidden="true"
              />
              <span className="stims-shell__sr-only">List view</span>
            </button>
          </div>
        </div>

        <nav
          ref={collectionChipsRef}
          className="ctl-scroller"
          aria-label="Preset collections"
        >
          <button
            type="button"
            className="ctl-chip"
            data-active={String(routeState.collectionTag === null)}
            aria-pressed={routeState.collectionTag === null}
            onClick={() => onCollectionTagChange(null)}
          >
            All
          </button>
          {featuredTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="ctl-chip"
              data-active={String(routeState.collectionTag === tag)}
              aria-pressed={routeState.collectionTag === tag}
              onClick={() =>
                onCollectionTagChange(
                  routeState.collectionTag === tag ? null : tag,
                )
              }
            >
              {prettifyCollectionTag(tag)}
              {collectionCounts.get(tag) ? (
                <span className="ctl-chip__count">
                  {collectionCounts.get(tag)?.toLocaleString()}
                </span>
              ) : null}
            </button>
          ))}
          <button
            type="button"
            className="ctl-chip"
            data-active={String(
              routeState.collectionTag === 'collection:community',
            )}
            aria-pressed={routeState.collectionTag === 'collection:community'}
            disabled={offline}
            onClick={() =>
              onCollectionTagChange(
                routeState.collectionTag === 'collection:community'
                  ? null
                  : 'collection:community',
              )
            }
          >
            Community
          </button>
        </nav>

        {/* Author and sort are both "refine the result set" selects, so they
            share one row and one visual language. Sort used to live alone in
            a bar BELOW the recently-played rail, visually divorced from the
            filters it belongs with — and in grid view that bar rendered
            after the whole result set, i.e. off-screen. The count rides
            along here because it is the readout for exactly these controls. */}
        <div className="ctl-browse-refine">
          {authorOptions.length > 0 ? (
            <select
              className="ctl-select"
              aria-label="Filter by author"
              value={authorFilter ?? ''}
              onChange={(e) => setAuthorFilter(e.target.value || null)}
            >
              <option value="">All authors</option>
              {authorOptions.map((author) => (
                <option key={author} value={author}>
                  {author}
                </option>
              ))}
            </select>
          ) : null}

          <select
            className="ctl-select"
            aria-label="Sort presets"
            value={sortMode}
            onChange={(e) => {
              const next = e.target.value as SortMode;
              setSortMode(next);
              if (next === 'random') setRandomSeed(Date.now());
              writeStored('stims:browse-sort', next);
            }}
          >
            <option value="relevance">Recommended</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
            <option value="recent">Recently opened</option>
            <option value="favorites-first">Saved first</option>
            <option value="webgpu-supported">High fidelity first</option>
            <option value="random">Random</option>
          </select>

          {/* The unit is a separate span so it can drop on narrow panels:
              this row is exactly full at ~348px and the word "presets" was
              taking 44px the two selects needed, leaving them to render as
              "All autho" / "Recomm". The number is the information. */}
          <p className="ctl-readout ctl-browse-count" aria-live="polite">
            {catalogReady ? (
              <>
                {sorted.length.toLocaleString()}
                <span className="ctl-browse-count__unit">
                  {` preset${sorted.length === 1 ? '' : 's'}`}
                </span>
              </>
            ) : (
              'loading…'
            )}
          </p>
        </div>

        {flashHiddenCount > 0 ? (
          <p className="ctl-browse-applied" aria-live="polite">
            <span>
              {`Reduce flashing is hiding ${flashHiddenCount.toLocaleString()} preset${
                flashHiddenCount === 1 ? '' : 's'
              }.`}
            </span>
            <button
              type="button"
              className="ctl-btn ctl-btn--quiet"
              onClick={() =>
                setAccessibilityPreference({ reduceFlashing: false })
              }
            >
              Show them
            </button>
          </p>
        ) : null}

        {hasFilter ? (
          <p
            className="ctl-browse-applied"
            aria-live="polite"
            aria-atomic="true"
          >
            <span>
              {buildAppliedFilterSummary({
                searchQuery: localSearch,
                collectionTag: routeState.collectionTag,
                authorFilter,
              })}
            </span>
            <button
              type="button"
              className="ctl-btn ctl-btn--quiet"
              onClick={clearFilters}
            >
              Clear
            </button>
          </p>
        ) : null}
      </section>

      {/* Two, not one: the rail costs a labelled row plus thumbnails — 17%
          of the panel's height — and a single tile is not a history worth
          that. Below the threshold the presets you just played are still
          the top of the "Recently opened" sort. */}
      {!hasFilter && recentEntries.length > 1 ? (
        <section
          className="ctl-recent-rail"
          aria-label="Recently played this session"
        >
          <p className="ctl-recent-rail__label">Recently played</p>
          <ul
            ref={recentRailRef}
            className="ctl-scroller ctl-recent-rail__list"
          >
            {recentEntries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="ctl-recent-rail__item"
                  title={entry.title}
                  onClick={(event) => {
                    runPresetPromoteTransition({
                      sourceElement: event.currentTarget,
                      presetId: entry.id,
                    });
                    engine.handlePresetSelection(entry.id);
                  }}
                >
                  <PresetArtwork
                    entry={entry}
                    compact
                    preview={presetPreviews[entry.id] ?? null}
                  />
                  <span className="ctl-recent-rail__title">{entry.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section ref={resultsRef} className="ctl-browse-results">
        {/* Both views roam with a roving tabindex, but the grid adds a
            horizontal axis — advertising only ↑↓ there understates it.
            Hidden on coarse pointers (see chrome.css): it costs a row of
            panel height to advertise keys a touch device does not have. */}
        <p className="ctl-keyboard-hint">
          {gridView ? (
            <>
              <kbd>←</kbd>
              <kbd>↑</kbd>
              <kbd>↓</kbd>
              <kbd>→</kbd> browse · <kbd>Home</kbd>
              <kbd>End</kbd> jump
            </>
          ) : (
            <>
              <kbd>↑</kbd>
              <kbd>↓</kbd> browse · <kbd>Home</kbd>
              <kbd>End</kbd> jump
            </>
          )}
        </p>

        {!catalogReady && !catalogError ? (
          <ul className="stims-shell__preset-list" aria-busy={true}>
            {Array.from({ length: 6 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have fixed order
              <li key={i}>
                <SkeletonPresetCard />
              </li>
            ))}
          </ul>
        ) : null}

        {catalogError ? (
          <div className="ctl-empty" role="alert">
            <span className="ctl-empty__title">
              Preset catalog failed to load
            </span>
            <p className="ctl-empty__body">{catalogError}</p>
          </div>
        ) : null}

        {catalogReady && sorted.length === 0 ? (
          <div className="ctl-empty">
            <span className="ctl-empty__title">Nothing matches that</span>
            <p className="ctl-empty__body">
              Widen the search, or clear the filters to see all {catalog.length}{' '}
              presets.
            </p>
            <button type="button" className="ctl-btn" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : null}

        {catalogReady && gridView ? (
          <PresetLineageSection
            catalog={catalog}
            currentPresetId={currentPresetId}
            onSelect={(presetId) => engine.handlePresetSelection(presetId)}
          />
        ) : null}

        {catalogReady && gridView && sorted.length > 0 ? (
          // `sorted`, not `browseEntries`: the grid follows the sort dropdown
          // like the list does. Renders inside .ctl-browse-results (below the
          // result count and sort control) rather than above it — the grid is
          // the default view, so with the bar underneath the whole result set
          // the count and sort were pushed off-screen behind ~2.5k tiles.
          <PresetGrid
            catalogEntries={sorted}
            presetPreviews={presetPreviews}
            requestPresetPreviews={engine.requestPresetPreviews}
            routeState={ui.routeState}
            setRouteState={setPresetRouteState}
            currentPresetId={currentPresetId}
            onToggleFavorite={(entry) => {
              void engine.toggleFavoritePreset(entry.id, !entry.isFavorite);
            }}
            initialScrollTop={browseScrollMemory.grid}
            onScrollTopChange={(top) => {
              browseScrollMemory.grid = top;
            }}
            filterEpoch={filterEpoch}
          />
        ) : null}

        {catalogReady && !gridView && sorted.length > 0 ? (
          // Virtualized: only the rows within the scroll viewport (plus
          // PRESET_ROW_OVERSCAN on each side) exist as real DOM nodes,
          // regardless of how many presets match the current filter — see
          // handlePresetListKeyDown above for how arrow/Home/End nav still
          // reaches rows that aren't currently rendered.
          <div
            ref={presetScrollRef}
            className="ctl-presets-scroll"
            // Written straight to module scope, never to state: this fires
            // on every scroll frame and a re-render per frame would undo the
            // virtualization it is riding on.
            onScroll={(event) => {
              browseScrollMemory.list = event.currentTarget.scrollTop;
            }}
          >
            {/* The lineage section scrolls WITH the list (matching its old
                position in normal document flow before virtualization)
                rather than sitting fixed above it. Its height varies with
                content, so the virtualizer needs scrollMargin kept in sync
                via the ResizeObserver below — otherwise its virtual-row
                offsets would assume the list starts right at the scroll
                container's top. */}
            <div ref={lineageWrapperRef}>
              <PresetLineageSection
                catalog={catalog}
                currentPresetId={currentPresetId}
                onSelect={(presetId) => engine.handlePresetSelection(presetId)}
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
                  rowVirtualizer.getTotalSize() -
                  rowVirtualizer.options.scrollMargin,
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const entry = sorted[virtualRow.index];
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
                    aria-setsize={sorted.length}
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
                    <button
                      type="button"
                      className="ctl-preset__open"
                      tabIndex={virtualRow.index === rovingIndex ? 0 : -1}
                      aria-current={
                        entry.id === currentPresetId ? 'true' : undefined
                      }
                      onClick={(event) => {
                        setRovingIndex(virtualRow.index);
                        runPresetPromoteTransition({
                          sourceElement: event.currentTarget,
                          presetId: entry.id,
                        });
                        engine.handlePresetSelection(entry.id);
                      }}
                    >
                      <span className="ctl-preset__art">
                        <PresetArtwork
                          entry={entry}
                          compact
                          preview={presetPreviews[entry.id] ?? null}
                        />
                      </span>
                      <span className="ctl-preset__copy">
                        <span className="ctl-preset__title">
                          {display.title}
                        </span>
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
                      title={
                        entry.isFavorite ? 'Remove from saved' : 'Save preset'
                      }
                      aria-pressed={Boolean(entry.isFavorite)}
                      onClick={() => {
                        void engine.toggleFavoritePreset(
                          entry.id,
                          !entry.isFavorite,
                        );
                      }}
                    >
                      <span
                        className="ctl-preset__fav-icon"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
