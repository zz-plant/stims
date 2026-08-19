import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AudioSource, PresetCatalogEntry } from './contracts.ts';
import { useListKeyboardNav } from './hooks/use-list-keyboard-nav.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import { PresetGrid } from './PresetGrid.tsx';
import { PresetLineageSection } from './PresetLineageSection.tsx';
import { SkeletonPresetCard } from './PresetShelfSection.tsx';
import { runPresetPromoteTransition } from './promote-transition.ts';
import { UiIcon } from './UiIcon.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';
import {
  type BrowseSortMode,
  buildAppliedFilterSummary,
  describePresetMood,
  getAuthorOptions,
  getFeaturedCollectionTags,
  matchesAuthor,
  matchesPreset,
  prettifyCollectionTag,
  sortBrowseEntries,
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

function readSortMode(): SortMode {
  try {
    return (
      (localStorage.getItem('stims:browse-sort') as SortMode) ?? 'relevance'
    );
  } catch {
    return 'relevance';
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
  const [gridView, setGridView] = useState(false);
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

  const featuredTags = getFeaturedCollectionTags(collectionTags);
  const hasFilter =
    localSearch.trim().length > 0 ||
    routeState.collectionTag !== null ||
    authorFilter !== null;

  const browseEntries = useMemo(
    () =>
      catalog.filter((entry) => {
        if (
          routeState.collectionTag &&
          routeState.collectionTag !== 'collection:community' &&
          !entry.tags?.includes(routeState.collectionTag)
        ) {
          return false;
        }
        return (
          matchesPreset(entry, deferredSearch) &&
          matchesAuthor(entry, authorFilter)
        );
      }),
    [catalog, routeState.collectionTag, deferredSearch, authorFilter],
  );

  const sorted = useMemo(
    () => sortBrowseEntries(browseEntries, sortMode, randomSeed),
    [browseEntries, sortMode, randomSeed],
  );

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll-to-top on filter changes specifically, not sorted identity
  useEffect(() => {
    if (sorted.length > 0) {
      rowVirtualizer.scrollToIndex(0, { align: 'start' });
    }
  }, [searchQuery, routeState.collectionTag, authorFilter]);

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

        <button
          type="button"
          className={gridView ? 'ctl-chip ctl-chip--active' : 'ctl-chip'}
          aria-pressed={gridView}
          onClick={() => setGridView((g) => !g)}
        >
          Grid
        </button>

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

      {!hasFilter && recentEntries.length > 0 ? (
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

      {catalogReady && gridView ? (
        // `sorted`, not `browseEntries`: the grid follows the sort dropdown
        // like the list does. It takes the full result set — offscreen tiles
        // are free via content-visibility, so the grid scrolls the whole
        // catalog without pagination.
        <PresetGrid
          catalogEntries={sorted}
          presetPreviews={presetPreviews}
          requestPresetPreviews={engine.requestPresetPreviews}
          routeState={ui.routeState}
          setRouteState={setPresetRouteState}
        />
      ) : null}

      <section ref={resultsRef} className="ctl-browse-results">
        <div className="ctl-resultbar">
          <p className="ctl-readout" aria-live="polite">
            {catalogReady
              ? `${sorted.length} preset${sorted.length === 1 ? '' : 's'}`
              : 'loading…'}
          </p>
          <select
            className="ctl-select ctl-select--auto"
            aria-label="Sort presets"
            value={sortMode}
            onChange={(e) => {
              const next = e.target.value as SortMode;
              setSortMode(next);
              if (next === 'random') setRandomSeed(Date.now());
              try {
                localStorage.setItem('stims:browse-sort', next);
              } catch {}
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
        </div>

        <p className="ctl-keyboard-hint">
          <kbd>↑</kbd>
          <kbd>↓</kbd> browse · <kbd>Home</kbd>
          <kbd>End</kbd> jump
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

        {catalogReady && !gridView && sorted.length > 0 ? (
          // Virtualized: only the rows within the scroll viewport (plus
          // PRESET_ROW_OVERSCAN on each side) exist as real DOM nodes,
          // regardless of how many presets match the current filter — see
          // handlePresetListKeyDown above for how arrow/Home/End nav still
          // reaches rows that aren't currently rendered.
          <div ref={presetScrollRef} className="ctl-presets-scroll">
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
                return (
                  <li
                    key={entry.id}
                    data-preset-index={virtualRow.index}
                    className="ctl-preset"
                    data-active={String(entry.id === currentPresetId)}
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
                        <span className="ctl-preset__title">{entry.title}</span>
                        <span className="ctl-preset__meta">
                          {describePresetMood(entry)}
                          {entry.author ? ` · ${entry.author}` : null}
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
