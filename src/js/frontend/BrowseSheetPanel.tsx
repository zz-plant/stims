/**
 * Browse Sheet Panel Component — renders the 1,787-preset library browser with search
 * filtering, collection tabs, mood curation, live animated previews, and queue management.
 */

import {
  useCallback,
  useDeferredValue,
  useEffect,
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
import {
  loadPresetVisualVectors,
  MAX_AFFINITY_ANCHORS,
  matchesVisualQuery,
  scoreVisualQuery,
} from '../core/services/preset-visual-vectors.ts';
import { readStored, writeStored } from '../core/state/browser-storage.ts';
import { isMobileDevice } from '../utils/browser/device-detect.ts';
import { BrowsePresetList } from './BrowsePresetList.tsx';
import type { AudioSource, PresetCatalogEntry } from './contracts.ts';
import { useListKeyboardNav } from './hooks/use-list-keyboard-nav.ts';
import { useScrollerOverflow } from './hooks/use-scroller-overflow.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import { PresetGrid } from './PresetGrid.tsx';
import { PresetLineageSection } from './PresetLineageSection.tsx';
import { openPresetInPlace, presetPageHref } from './preset-link.ts';
import { normalizeMatchText } from './preset-matching.ts';
import { runPresetPromoteTransition } from './promote-transition.ts';
import {
  clearQuickSelectEntries,
  publishQuickSelectEntries,
} from './quick-select.ts';
import { SkeletonPresetCard } from './SkeletonPresetCard.tsx';
import { UiIcon } from './UiIcon.tsx';
import { togglePresetQueuedAction } from './workspace-actions.ts';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';
import {
  type BrowseSortMode,
  buildAppliedFilterSummary,
  createFieldMatcher,
  getAuthorOptions,
  getCollectionCounts,
  getFeaturedCollectionTags,
  matchesAuthor,
  matchesPreset,
  parseBrowseSortMode,
  passesFlashPreference,
  pickFavoritePresets,
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

/**
 * Where the browser can pick a folder, the import button picks a folder (a
 * MilkDrop install is a folder of hundreds of .milk files) and cannot pick a
 * single file; elsewhere it opens a file picker. The label says which.
 */
const IMPORT_LABEL =
  typeof window !== 'undefined' && 'showDirectoryPicker' in window
    ? 'Import a folder of presets (.milk, .txt or .zip files in it)'
    : 'Import preset files (.milk or .zip)';

function readSortMode(): SortMode {
  return parseBrowseSortMode(readStored('stims:browse-sort')) ?? 'curated';
}

/**
 * Grid is the default: presets are picked by how they look, and the 54px list
 * row can only show a thumbnail too small to judge. The list view stays for
 * scanning a long catalog by name.
 */
function readGridView(): boolean {
  return (readStored('stims:browse-view') ?? 'grid') === 'grid';
}

/**
 * Opens the directory picker and collects the preset files in the folder.
 *
 * Module scope, not inline in the import button's handler: React Compiler
 * cannot lower a `for await` loop and skips the whole enclosing component.
 * Rejects when the visitor cancels the picker.
 */
async function pickPresetFilesFromDirectory(): Promise<File[]> {
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
        entry.name.endsWith('.txt') ||
        entry.name.endsWith('.zip'))
    ) {
      const file = await entry.getFile();
      files.push(file);
    }
  }
  return files;
}

export function BrowseSheetPanel({
  onCollectionTagChange,
  onImport,
  onPresetChosen,
  sessionHistory = [],
}: {
  onCollectionTagChange: (tag: string | null) => void;
  onImport: (files: FileList | File[] | null) => void;
  /**
   * Fired when the visitor picks a preset from this panel — a click, a tap or
   * an Enter on a tile, a row, or a lineage entry.
   *
   * Deliberately distinct from "the playing preset changed", which is a much
   * weaker signal: the engine also changes presets on its own (idle autoplay
   * on arrival, autoplay shuffling during a session), and on a mobile or
   * low-power `/discover/…` arrival that automatic start lands while the
   * browse panel is open and nothing has been tapped.
   */
  onPresetChosen?: (presetId: string) => void;
  sessionHistory?: Array<{ presetId: string; title: string; at: number }>;
}) {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const catalog = engine.catalog;
  const catalogError = engine.catalogError;
  const catalogReady = engine.catalogReady;
  const collectionTags = engine.collectionTags;
  const currentPresetId = engineSnapshot?.activePresetId ?? null;

  /**
   * The one path a preset is chosen through from this panel.
   *
   * Every selection site below routes here rather than calling the engine
   * directly, so "the visitor picked this" has a single definition that
   * callers can hook — and so a new selection site cannot quietly skip it.
   */
  // Read off `engine` before the callbacks close over them: a dependency
  // list naming `engine.method` cannot be preserved by React Compiler, which
  // infers `engine` from the call. The methods are plain closures.
  const {
    audioActive,
    handleAudioStart,
    handlePresetSelection,
    toggleFavoritePreset,
  } = engine;
  const selectPreset = useCallback(
    (presetId: string) => {
      onPresetChosen?.(presetId);
      // The first-use hint says a card plays its preset. Before any audio
      // has started, selecting only moved the route: on a phone, or with
      // the background preview off, the panel closed onto nothing playing.
      // Start the demo track with the chosen preset, as the home cards do.
      if (!audioActive) {
        void handleAudioStart('demo', undefined, presetId);
        return;
      }
      handlePresetSelection(presetId);
    },
    [audioActive, handleAudioStart, handlePresetSelection, onPresetChosen],
  );
  const presetPreviews = engine.presetPreviews;
  const routeState = ui.routeState;
  const searchQuery = ui.searchQuery;

  const [sortMode, setSortMode] = useState<SortMode>(readSortMode);
  const [randomSeed, setRandomSeed] = useState(() => Date.now());
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const deferredSearch = useDeferredValue(localSearch);
  const [authorFilter, setAuthorFilter] = useState<string | null>(
    routeState.discovery?.author ?? null,
  );
  useEffect(() => {
    setAuthorFilter(routeState.discovery?.author ?? null);
  }, [routeState.discovery?.author]);
  const [gridView, setGridView] = useState(readGridView);
  const resultsRef = useRef<HTMLElement | null>(null);

  // Wrapper for PresetGrid — only passes presetId and audioSource
  const setPresetRouteState = (next: {
    presetId: string | null;
    audioSource: AudioSource | null;
  }) => {
    // The grid opens a preset by committing route state rather than calling
    // the engine, so this is the other half of the selection path and has to
    // report a choice too — it is in fact the primary one, since the grid is
    // the default browse view and a tile click is the "tap a card" this
    // panel's first-use hint is about.
    if (next.presetId) onPresetChosen?.(next.presetId);
    if (next.presetId && !engine.audioActive) {
      void engine.handleAudioStart('demo', undefined, next.presetId);
      return;
    }
    ui.commitRoute((current) => ({
      ...current,
      ...next,
      panel: null,
    }));
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

  // A search made only of visual terms ("tunnel", "blue fire") also lists and
  // ranks presets by how much their preview looks like it. Kept with the
  // query it answers, so a slower result for "tunnel" cannot apply to the
  // "tunnel x" typed since; until it arrives the tags alone answer.
  const normalizedSearch = useMemo(
    () => normalizeMatchText(deferredSearch),
    [deferredSearch],
  );
  const [visualResult, setVisualResult] = useState<{
    query: string;
    scores: ReadonlyMap<string, number>;
  } | null>(null);
  useEffect(() => {
    if (!normalizedSearch) return;
    let cancelled = false;
    void scoreVisualQuery(normalizedSearch).then((scores) => {
      if (!cancelled) setVisualResult({ query: normalizedSearch, scores });
    });
    return () => {
      cancelled = true;
    };
  }, [normalizedSearch]);
  const visualScores = useMemo<ReadonlyMap<string, number>>(
    () =>
      visualResult?.query === normalizedSearch
        ? visualResult.scores
        : new Map(),
    [visualResult, normalizedSearch],
  );

  const browseEntries = useMemo(() => {
    const matcher = deferredSearch
      ? createFieldMatcher(deferredSearch, { allowSubsequence: false })
      : null;
    return catalog.filter((entry) => {
      if (
        routeState.collectionTag === 'collection:favorites' ||
        routeState.collectionTag === 'favorites'
      ) {
        if (!entry.isFavorite) return false;
      } else if (
        routeState.collectionTag &&
        !entry.tags?.includes(routeState.collectionTag)
      ) {
        return false;
      }
      return (
        passesFlashPreference(entry, reduceFlashing) &&
        (matcher
          ? matchesPreset(entry, matcher) ||
            matchesVisualQuery(entry.id, visualScores)
          : true) &&
        matchesAuthor(entry, authorFilter)
      );
    });
  }, [
    catalog,
    routeState.collectionTag,
    deferredSearch,
    visualScores,
    authorFilter,
    reduceFlashing,
  ]);

  // Saved presets, most recently opened first: the anchors 'like-saved'
  // ranks against. Joined into a key so the affinity pass reruns only when
  // the saved set changes, not on every catalog activity update.
  const savedKey = useMemo(
    () =>
      sortMode === 'like-saved'
        ? pickFavoritePresets(catalog, MAX_AFFINITY_ANCHORS)
            .map((entry) => entry.id)
            .join('\n')
        : '',
    [catalog, sortMode],
  );
  const [affinity, setAffinity] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  useEffect(() => {
    if (!savedKey) {
      setAffinity(new Map());
      return;
    }
    let cancelled = false;
    void loadPresetVisualVectors().then((vectors) => {
      if (cancelled) return;
      setAffinity(vectors?.affinity(savedKey.split('\n')) ?? new Map());
    });
    return () => {
      cancelled = true;
    };
  }, [savedKey]);

  const sorted = useMemo(
    () =>
      sortBrowseEntries(
        browseEntries,
        sortMode,
        randomSeed,
        deferredSearch,
        affinity,
        visualScores,
      ),
    [
      browseEntries,
      sortMode,
      randomSeed,
      deferredSearch,
      affinity,
      visualScores,
    ],
  );

  // At most the queue's cap (50) ids, so a Set lookup per mounted row is O(1).
  const queuedPresetIds = ui.presetQueue.presetIds;
  const queuedPresetIdSet = useMemo(
    () => new Set(queuedPresetIds),
    [queuedPresetIds],
  );
  const toggleQueued = useCallback(
    (entry: PresetCatalogEntry) => {
      togglePresetQueuedAction({
        queue: ui.presetQueue,
        entry,
        announce: ui.setStatusMessage,
      });
    },
    [ui.presetQueue, ui.setStatusMessage],
  );
  const handleToggleFavorite = useCallback(
    (entry: PresetCatalogEntry) => {
      void toggleFavoritePreset(entry.id, !entry.isFavorite);
    },
    [toggleFavoritePreset],
  );

  // In list view this panel is what the digit keys index; in grid view the
  // grid publishes its own (variant-collapsed) order. Only one is mounted.
  //
  // The digits are shown only while they would work. Opening the panel puts
  // focus in the search field, and a digit typed there is a search — the
  // shell's shortcut layer hands every keystroke in a text field to the
  // field. With the badges up at that moment, pressing 1 wrote "1" into the
  // query (and filtered the list to titles containing a 1) instead of playing
  // card 1. Hidden while the field has focus, they reappear the moment
  // focus leaves it — Tab, Enter on the query, a click on a chip — which is
  // also when the keys start answering.
  const [searchFocused, setSearchFocused] = useState(false);
  const showQuickSelectKeys = !isMobileDevice() && !searchFocused;
  useEffect(() => {
    if (gridView) return;
    publishQuickSelectEntries(sorted.map((entry) => entry.id));
    return clearQuickSelectEntries;
  }, [gridView, sorted]);

  /**
   * How many presets "Reduce flashing" is holding back.
   *
   * This preference defaults to ON whenever the OS reports reduced-motion,
   * so it is routinely on without ever having been chosen — and unlike the
   * search and author filters it is invisible here, has no chip, and is not
   * touched by "Clear filters". The result was a library quietly missing
   * presets with nothing on screen accounting for them.
   */
  /**
   * Live, the engine's weighted shuffle picks. Before any audio has
   * started there is nothing for it to switch, so pick from the list on
   * screen (which already leaves out what Reduce flashing hides) and start
   * it like a card click.
   */
  const playRandomPreset = () => {
    if (engine.audioActive) {
      engine.handleShufflePreset();
      return;
    }
    const pool = sorted.filter((entry) => entry.id !== currentPresetId);
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? sorted[0];
    if (pick) selectPreset(pick.id);
  };

  const flashHiddenCount = useMemo(() => {
    if (!reduceFlashing) return 0;
    return catalog.filter((entry) => !passesFlashPreference(entry, true))
      .length;
  }, [catalog, reduceFlashing]);

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
  useScrollerOverflow(collectionChipsRef, [featuredTags.length]);
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

  // Send both views back to the top when filters change — mirrors the old
  // pagination reset (a fresh filter previously meant "start from batch one
  // again").
  //
  // The mount run is skipped so it cannot stomp the remembered offset each
  // view restores on mount: this effect's deps are all filter values, which
  // "change" once on mount by definition. `filterEpoch` lets the list and
  // the grid — which each own their scroll element — reset in step without
  // having to work out whether a new entry list came from a filter or a
  // re-sort.
  const filterSettledRef = useRef(false);
  const [filterEpoch, setFilterEpoch] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter changes specifically, not sorted identity
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
  }, [searchQuery, routeState.collectionTag, authorFilter]);

  return (
    <div
      className="stims-shell__sheet-panel stims-shell__sheet-panel--browse"
      data-telemetry-surface="browse"
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
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
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
          {/* Plays a random preset and closes Browse; it does not reorder
              the list (the sort menu's Random does that). */}
          <button
            type="button"
            className="ctl-btn ctl-btn--icon"
            onClick={playRandomPreset}
            disabled={catalog.length === 0}
            aria-label="Play a random preset"
            title="Play a random preset"
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
                  const files = await pickPresetFilesFromDirectory();
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
            aria-label={IMPORT_LABEL}
            title={`${IMPORT_LABEL}. Imported presets open in the editor.`}
          >
            <UiIcon
              name="upload"
              className="stims-icon-slot stims-icon-slot--sm"
              aria-hidden="true"
            />
          </button>
          {/* The presets you made or imported live only in this browser;
              this is their backup, as MilkDrop 2 files in one pack. */}
          <button
            type="button"
            className="ctl-btn ctl-btn--icon"
            onClick={() => {
              void engine.exportUserPresets();
            }}
            aria-label="Download my presets as a .zip"
            title="Download the presets you made or imported, as a .zip of MilkDrop 2 files"
          >
            <UiIcon
              name="download"
              className="stims-icon-slot stims-icon-slot--sm"
              aria-hidden="true"
            />
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".milk,.zip,text/plain,application/zip"
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
          <button
            type="button"
            className="ctl-chip"
            data-active={String(
              routeState.collectionTag === 'collection:favorites',
            )}
            aria-pressed={routeState.collectionTag === 'collection:favorites'}
            onClick={() =>
              onCollectionTagChange(
                routeState.collectionTag === 'collection:favorites'
                  ? null
                  : 'collection:favorites',
              )
            }
          >
            ★ Saved
            {engine.favoritePresets.length > 0 ? (
              <span className="ctl-chip__count">
                {engine.favoritePresets.length.toLocaleString()}
              </span>
            ) : null}
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
            <option value="curated">Curated first</option>
            <option value="relevance">Best match</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
            <option value="recent">Recently opened</option>
            <option value="favorites-first">Saved first</option>
            <option value="like-saved">Like your saved</option>
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
              }. Turning it off also stops the stage dimming flashes.`}
            </span>
            {/* This switches the saved setting off everywhere, live dimming
                included. It used to read "Show them", which sounded like a
                list filter. */}
            <button
              type="button"
              className="ctl-btn ctl-btn--quiet"
              onClick={() =>
                setAccessibilityPreference({ reduceFlashing: false })
              }
            >
              Turn off Reduce flashing
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
                <a
                  href={presetPageHref(entry.id)}
                  className="ctl-recent-rail__item"
                  title={entry.title}
                  onClick={(event) =>
                    openPresetInPlace(event, () => {
                      runPresetPromoteTransition({
                        sourceElement: event.currentTarget,
                        presetId: entry.id,
                      });
                      selectPreset(entry.id);
                    })
                  }
                >
                  <PresetArtwork
                    entry={entry}
                    compact
                    preview={presetPreviews[entry.id] ?? null}
                  />
                  <span className="ctl-recent-rail__title">{entry.title}</span>
                </a>
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
          {/* The numbered corner badges on the first nine cards are these
              keys. Named only while the badges are drawn, so the line never
              advertises a key that is not answering. */}
          {showQuickSelectKeys ? (
            <>
              {' · '}
              <kbd>1</kbd>–<kbd>9</kbd> play a numbered card
            </>
          ) : null}
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
            onSelect={selectPreset}
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
            onToggleFavorite={handleToggleFavorite}
            queuedPresetIds={queuedPresetIds}
            onToggleQueued={toggleQueued}
            readInitialScrollTop={() => browseScrollMemory.grid}
            onScrollTopChange={(top) => {
              browseScrollMemory.grid = top;
            }}
            filterEpoch={filterEpoch}
            showQuickSelectKeys={showQuickSelectKeys}
          />
        ) : null}

        <BrowsePresetList
          visible={catalogReady && !gridView && sorted.length > 0}
          entries={sorted}
          catalog={catalog}
          currentPresetId={currentPresetId}
          presetPreviews={presetPreviews}
          queuedPresetIdSet={queuedPresetIdSet}
          showQuickSelectKeys={showQuickSelectKeys}
          filterEpoch={filterEpoch}
          readInitialScrollTop={() => browseScrollMemory.list}
          onScrollTopChange={(top) => {
            browseScrollMemory.list = top;
          }}
          onSelect={selectPreset}
          onToggleQueued={toggleQueued}
          onToggleFavorite={handleToggleFavorite}
        />
      </section>
    </div>
  );
}
