import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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

const BATCH_SIZE = 30;
type SortMode = BrowseSortMode;

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
  const [limit, setLimit] = useState(BATCH_SIZE);
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
  const recentRailRef = useRef<HTMLUListElement | null>(null);
  const collectionChipsRef = useRef<HTMLElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const authorOptions = useMemo(() => getAuthorOptions(catalog), [catalog]);
  const moreRef = useRef<HTMLDivElement | null>(null);

  // Synchronize local search state when global searchQuery is modified externally (e.g. clear filters)
  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  // Debounce sync from localSearch to global searchQuery
  useEffect(() => {
    if (localSearch === searchQuery) return;
    const timer = setTimeout(() => {
      ui.setSearchQuery(localSearch);
    }, 150);
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

  // Auto-scroll active preset into view on initial open or selection
  useEffect(() => {
    if (!currentPresetId || !presetListRef.current) return;
    const activeEl = presetListRef.current.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentPresetId]);
  const sorted = useMemo(
    () => sortBrowseEntries(browseEntries, sortMode, randomSeed),
    [browseEntries, sortMode, randomSeed],
  );
  const visible = sorted.slice(0, limit);
  const hiddenCount = sorted.length - visible.length;

  // Arrow-key roving nav: Tab into the list costs one stop (lands on the
  // active item), Up/Down/Home/End move within it. Without this, reaching
  // the Nth preset by keyboard costs 2N Tab presses (open + favorite button
  // per row) — thousands at the catalog's full size.
  useListKeyboardNav(presetListRef, {
    itemSelector: '.ctl-preset__open',
    orientation: 'vertical',
    deps: [visible.length],
  });
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

  // Reset pagination when filters change
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset limit on filter changes
  useEffect(() => {
    setLimit(BATCH_SIZE);
  }, [searchQuery, routeState.collectionTag, authorFilter]);

  // Infinite scroll observer: automatically append the next batch when approaching the bottom
  useEffect(() => {
    if (hiddenCount <= 0 || !moreRef.current) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const target = moreRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setLimit((l) => l + BATCH_SIZE);
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hiddenCount]);

  return (
    <div
      className="stims-shell__sheet-panel stims-shell__sheet-panel--browse"
      data-filter-active={String(hasFilter)}
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
        <PresetGrid
          catalogEntries={browseEntries}
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

        {catalogReady ? (
          <PresetLineageSection
            catalog={catalog}
            currentPresetId={currentPresetId}
            onSelect={(presetId) => engine.handlePresetSelection(presetId)}
          />
        ) : null}

        {catalogReady && !gridView && sorted.length > 0 ? (
          <ul ref={presetListRef} className="ctl-presets">
            {visible.map((entry) => (
              <li
                key={entry.id}
                className="ctl-preset"
                data-active={String(entry.id === currentPresetId)}
              >
                <button
                  type="button"
                  className="ctl-preset__open"
                  aria-current={
                    entry.id === currentPresetId ? 'true' : undefined
                  }
                  onClick={(event) => {
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
                  title={entry.isFavorite ? 'Remove from saved' : 'Save preset'}
                  aria-pressed={Boolean(entry.isFavorite)}
                  onClick={() => {
                    void engine.toggleFavoritePreset(
                      entry.id,
                      !entry.isFavorite,
                    );
                  }}
                >
                  <span className="ctl-preset__fav-icon" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {hiddenCount > 0 ? (
          <div ref={moreRef} className="ctl-browse-more">
            <button
              type="button"
              className="ctl-btn"
              onClick={() => setLimit((l) => l + BATCH_SIZE)}
            >
              Show {Math.min(BATCH_SIZE, hiddenCount)} more
            </button>
            <span className="ctl-readout">
              {visible.length} of {sorted.length}
            </span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
