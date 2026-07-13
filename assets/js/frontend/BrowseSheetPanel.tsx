import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchByFrame } from '../core/services/visual-embedding.ts';
import { PRESET_PREVIEW_REQUEST_LIMIT } from '../milkdrop/preset-preview.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import {
  PresetShelfSection,
  SkeletonPresetCard,
} from './PresetShelfSection.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';
import {
  buildAppliedFilterSummary,
  describePresetMood,
  getFeaturedCollectionTags,
  prettifyCollectionTag,
} from './workspace-helpers.ts';

const BROWSE_RESULT_BATCH_SIZE = 24;
type SortMode =
  | 'relevance'
  | 'title'
  | 'author'
  | 'recent'
  | 'favorites-first'
  | 'webgpu-supported'
  | 'random';

type ImageToPresetResponse = {
  description?: string;
  milkSource?: string;
  presetId?: string;
  title?: string;
};

export type ImageToPresetAction =
  | {
      kind: 'generated-source';
      description: string;
      source: string;
      title: string;
    }
  | {
      kind: 'preset-id';
      description: string;
      presetId: string;
    };

export function resolveImageToPresetAction(
  data: ImageToPresetResponse,
): ImageToPresetAction | null {
  const description = data.description?.trim() || 'Generated from image.';
  const source = data.milkSource?.trim();
  if (source) {
    return {
      kind: 'generated-source',
      description,
      source,
      title: data.title?.trim() || 'Image generated preset',
    };
  }

  const presetId = data.presetId?.trim();
  if (presetId) {
    return {
      kind: 'preset-id',
      description,
      presetId,
    };
  }

  return null;
}

function readSortMode(): SortMode {
  try {
    const value = localStorage.getItem('stims:browse-sort') as SortMode | null;
    return value ?? 'relevance';
  } catch {
    return 'relevance';
  }
}

function sortPresetEntries(
  entries: PresetCatalogEntry[],
  sortMode: SortMode,
  randomSeed: number,
) {
  const sorted = [...entries];
  if (sortMode === 'title') {
    return sorted.sort((a, b) => a.title.localeCompare(b.title));
  }
  if (sortMode === 'author') {
    return sorted.sort((a, b) =>
      (a.author ?? 'Unknown').localeCompare(b.author ?? 'Unknown'),
    );
  }
  if (sortMode === 'recent') {
    return sorted.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
  }
  if (sortMode === 'favorites-first') {
    return sorted.sort(
      (a, b) => Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite)),
    );
  }
  if (sortMode === 'webgpu-supported') {
    return sorted.sort(
      (a, b) =>
        Number(Boolean(b.supports?.webgpu)) -
        Number(Boolean(a.supports?.webgpu)),
    );
  }
  if (sortMode === 'random') {
    return sorted.sort((a, b) =>
      `${a.id}:${randomSeed}`.localeCompare(`${b.id}:${randomSeed}`),
    );
  }
  return sorted;
}

function findScrollableAncestor(element: HTMLElement | null) {
  let parent = element?.parentElement ?? null;
  while (parent) {
    const style = window.getComputedStyle(parent);
    const canScroll =
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      parent.scrollHeight > parent.clientHeight;
    if (canScroll) return parent;
    parent = parent.parentElement;
  }
  return null;
}

export function BrowseSheetPanel({
  onCollectionTagChange,
  onImport,
  offline = false,
  sessionHistory = [],
}: {
  onCollectionTagChange: (collectionTag: string | null) => void;
  onImport: (files: FileList | null) => void;
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
  const favoritePresets = engine.favoritePresets;
  const filteredCatalog = engine.filteredCatalog;
  const presetPreviews = engine.presetPreviews;
  const recentPresets = engine.recentPresets;
  const routeState = ui.routeState;
  const searchQuery = ui.searchQuery;
  const starterPresets = engine.starterPresets;
  const catalogEntryById = useMemo(
    () => new Map(catalog.map((entry) => [entry.id, entry] as const)),
    [catalog],
  );

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [communityPresets, setCommunityPresets] = useState<
    PresetCatalogEntry[]
  >([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [visualSearchResults, setVisualSearchResults] = useState<
    Array<{ presetId: string; score: number }>
  >([]);
  const [visualSearchLoading, setVisualSearchLoading] = useState(false);
  const [visualSearchActive, setVisualSearchActive] = useState(false);
  const [imageImportResult, setImageImportResult] = useState<{
    description: string;
    label: string;
  } | null>(null);
  const [imageImportLoading, setImageImportLoading] = useState(false);
  const [fileImportStatus, setFileImportStatus] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>(readSortMode);
  const [randomSeed, setRandomSeed] = useState(() => Date.now());
  const [previewingPresetId, setPreviewingPresetId] = useState<string | null>(
    null,
  );
  const imageImportAbortRef = useRef<AbortController | null>(null);
  const communityAbortRef = useRef<AbortController | null>(null);
  const visualSearchAbortRef = useRef<AbortController | null>(null);
  const resultsSectionRef = useRef<HTMLElement | null>(null);
  const [visibleCatalogState, setVisibleCatalogState] = useState({
    key: '',
    limit: BROWSE_RESULT_BATCH_SIZE,
  });

  useEffect(() => {
    return () => {
      imageImportAbortRef.current?.abort();
      communityAbortRef.current?.abort();
      visualSearchAbortRef.current?.abort();
    };
  }, []);

  const handleImageImport = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (offline) {
      ui.setStatusMessage('Image-to-preset needs a network connection.');
      return;
    }
    const file = files[0];
    const formData = new FormData();
    formData.append('image', file);

    imageImportAbortRef.current?.abort();
    const controller = new AbortController();
    imageImportAbortRef.current = controller;
    setImageImportLoading(true);
    setImageImportResult(null);
    try {
      const res = await fetch('/api/image-to-preset', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        let serverMessage = `Server returned ${res.status}`;
        try {
          const errBody = (await res.json()) as { error?: string };
          if (errBody.error) serverMessage = errBody.error;
        } catch {
          // Use default message if JSON parse fails
        }
        throw new Error(serverMessage);
      }
      const data = (await res.json()) as ImageToPresetResponse;
      if (controller.signal.aborted) return;
      const action = resolveImageToPresetAction(data);
      if (!action) {
        throw new Error('No preset source or preset id returned.');
      }

      if (action.kind === 'generated-source') {
        document.dispatchEvent(
          new CustomEvent('stims:editor:source-change', {
            detail: {
              source: action.source,
              title: action.title,
            },
          }),
        );
        setImageImportResult({
          description: action.description,
          label: action.title,
        });
        ui.setStatusMessage('Generated preset from image. Opening editor.');
        ui.updatePanel('editor');
      } else {
        setImageImportResult({
          description: action.description,
          label: action.presetId,
        });
        engine.handlePresetSelection(action.presetId);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Unknown error';
      ui.setStatusMessage(`Image import failed: ${message}`);
    } finally {
      if (imageImportAbortRef.current === controller) {
        imageImportAbortRef.current = null;
        setImageImportLoading(false);
      }
    }
  };

  const loadCommunityPresets = useCallback(() => {
    if (offline) {
      setCommunityError(
        'Community presets are unavailable in offline party mode.',
      );
      return;
    }
    communityAbortRef.current?.abort();
    const controller = new AbortController();
    communityAbortRef.current = controller;
    setCommunityLoading(true);
    setCommunityError(null);
    fetch('/api/presets?sort=top&limit=20', { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return null;
        if (!res.ok) {
          throw new Error(`Unable to load community presets (${res.status}).`);
        }
        return res.json();
      })
      .then((data) => {
        if (!data || controller.signal.aborted) return;
        const presets = Array.isArray(data.presets) ? data.presets : [];
        setCommunityPresets(presets);
      })
      .catch((err: Error) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setCommunityError(err.message);
      })
      .finally(() => {
        if (communityAbortRef.current === controller) {
          communityAbortRef.current = null;
          setCommunityLoading(false);
        }
      });
  }, [offline]);

  useEffect(() => {
    if (routeState.collectionTag === 'collection:community' && !offline) {
      loadCommunityPresets();
    }
  }, [routeState.collectionTag, loadCommunityPresets, offline]);

  const handleVisualSearch = async () => {
    const canvas = ui.stageRef.current?.querySelector(
      'canvas',
    ) as HTMLCanvasElement | null;
    if (!canvas) {
      ui.setStatusMessage('No visual frame available yet.');
      return;
    }
    visualSearchAbortRef.current?.abort();
    const controller = new AbortController();
    visualSearchAbortRef.current = controller;
    setVisualSearchLoading(true);
    setVisualSearchActive(true);
    try {
      const results = await searchByFrame(canvas, controller.signal);
      if (controller.signal.aborted) return;
      setVisualSearchResults(results);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      ui.setStatusMessage('Finding similar presets failed.');
    } finally {
      if (visualSearchAbortRef.current === controller) {
        visualSearchAbortRef.current = null;
        setVisualSearchLoading(false);
      }
    }
  };

  const handleImportFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setFileImportStatus(
      `Importing ${files.length} preset file${files.length === 1 ? '' : 's'}…`,
    );
    onImport(files);
    setFileImportStatus(
      `Import started for ${files.length} preset file${files.length === 1 ? '' : 's'}.`,
    );
  };

  const handleDeselectVisualSearch = () => {
    setVisualSearchActive(false);
    setVisualSearchResults([]);
  };
  const handleQueuePreset = (presetId: string) => {
    const entry = catalogEntryById.get(presetId);
    if (!entry) return;
    ui.presetQueue.add(entry.id);
    ui.setStatusMessage(`${entry.title} added to queue.`);
  };
  const playNextQueuedPreset = () => {
    const nextId = ui.presetQueue.popNext();
    if (!nextId) return;
    engine.handlePresetSelection(nextId);
  };

  const showStarterPresets =
    searchQuery.trim().length === 0 && routeState.collectionTag === null;
  const hasActiveBrowseFilter =
    searchQuery.trim().length > 0 ||
    routeState.collectionTag !== null ||
    visualSearchActive;
  const showActivitySections = showStarterPresets;
  const featuredCollectionTags = getFeaturedCollectionTags(collectionTags);
  const hiddenCollectionTags = collectionTags.filter(
    (tag) => !featuredCollectionTags.includes(tag),
  );
  const usingHiddenCollectionFilter =
    routeState.collectionTag !== null &&
    !featuredCollectionTags.includes(routeState.collectionTag);
  const browseResetKey = `${routeState.collectionTag ?? 'all'}::${searchQuery}`;
  const visibleCatalogLimit =
    visibleCatalogState.key === browseResetKey
      ? visibleCatalogState.limit
      : BROWSE_RESULT_BATCH_SIZE;
  const browseEntries =
    routeState.collectionTag === 'collection:community'
      ? communityPresets
      : filteredCatalog;
  const sortedBrowseEntries = useMemo(
    () => sortPresetEntries(browseEntries, sortMode, randomSeed),
    [browseEntries, sortMode, randomSeed],
  );
  const visibleBrowseEntries =
    routeState.collectionTag === 'collection:community'
      ? sortedBrowseEntries
      : sortedBrowseEntries.slice(0, visibleCatalogLimit);
  const hiddenBrowseEntryCount =
    sortedBrowseEntries.length - visibleBrowseEntries.length;
  const browseResultsScrollKey = hasActiveBrowseFilter
    ? [
        searchQuery.trim(),
        routeState.collectionTag ?? '',
        String(visualSearchActive),
        String(visibleBrowseEntries.length),
        String(visualSearchResults.length),
        String(communityPresets.length),
      ].join('::')
    : '';
  const visiblePreviewIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    const push = (items: Array<{ id: string }>) => {
      for (let i = 0; i < items.length; i++) {
        const id = items[i].id;
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    };
    if (starterPresets.length > 0) {
      const starters = starterPresets;
      for (let i = 0; i < starters.length; i++) {
        push([starters[i].preset]);
      }
    }
    push(recentPresets);
    push(favoritePresets);
    push(filteredCatalog);
    return ids.slice(0, PRESET_PREVIEW_REQUEST_LIMIT);
  }, [starterPresets, recentPresets, favoritePresets, filteredCatalog]);
  const previewCounts = useMemo(
    () =>
      visiblePreviewIds.reduce(
        (summary, presetId) => {
          const preview = presetPreviews[presetId];
          if (!preview || preview.status === 'queued') {
            summary.queued += 1;
            return summary;
          }

          summary[preview.status] += 1;
          return summary;
        },
        {
          queued: 0,
          capturing: 0,
          ready: 0,
          failed: 0,
        },
      ),
    [visiblePreviewIds, presetPreviews],
  );
  const previewSummary = useMemo(
    () =>
      [
        previewCounts.ready ? `${previewCounts.ready} ready` : '',
        previewCounts.capturing ? `${previewCounts.capturing} capturing` : '',
        previewCounts.queued ? `${previewCounts.queued} queued` : '',
        previewCounts.failed ? `${previewCounts.failed} failed` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    [previewCounts],
  );

  useEffect(() => {
    if (visiblePreviewIds.length === 0) return;

    const request = () => engine.requestPresetPreviews(visiblePreviewIds);
    const handle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(request, { timeout: 1500 })
        : setTimeout(request, 750);

    return () => {
      if (
        typeof cancelIdleCallback === 'function' &&
        typeof handle === 'number'
      ) {
        cancelIdleCallback(handle);
      } else {
        clearTimeout(handle);
      }
    };
  }, [visiblePreviewIds, engine.requestPresetPreviews]);

  useEffect(() => {
    if (usingHiddenCollectionFilter) {
      setShowAdvancedFilters(true);
    }
  }, [usingHiddenCollectionFilter]);

  useEffect(() => {
    if (!browseResultsScrollKey) return;

    const handle = setTimeout(() => {
      const resultsSection = resultsSectionRef.current;
      const scroller = findScrollableAncestor(resultsSection);
      if (resultsSection && scroller) {
        const sectionRect = resultsSection.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        scroller.scrollTo({
          top: scroller.scrollTop + sectionRect.top - scrollerRect.top - 8,
          behavior: 'smooth',
        });
        return;
      }

      resultsSection?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
    }, 150);

    return () => clearTimeout(handle);
  }, [browseResultsScrollKey]);

  return (
    <div
      className="stims-shell__sheet-panel stims-shell__sheet-panel--browse"
      data-filter-active={String(hasActiveBrowseFilter)}
    >
      <section className="stims-shell__sheet-surface stims-shell__sheet-surface--sticky">
        <div className="stims-shell__browse-toolbar">
          <div className="stims-shell__browse-toolbar-copy">
            <strong>Browse presets</strong>
          </div>
          <div className="stims-shell__browse-toolbar-actions">
            <button
              type="button"
              className="stims-shell__text-button"
              onClick={engine.handleShufflePreset}
              disabled={catalog.length === 0}
            >
              Surprise me
            </button>
            <details className="stims-shell__browse-toolbar-extras">
              <summary
                className="stims-shell__text-button"
                aria-label="Preset preview tools"
              >
                Previews
              </summary>
              <div className="stims-shell__browse-toolbar-extras-body">
                <p
                  className="stims-shell__meta-copy"
                  data-testid="browse-preview-summary"
                >
                  Preview status: {previewSummary || 'loading thumbnails'}
                </p>
                <button
                  type="button"
                  className="stims-shell__text-button"
                  onClick={() =>
                    engine.refreshPresetPreviews(visiblePreviewIds)
                  }
                  disabled={visiblePreviewIds.length === 0}
                >
                  Refresh previews
                </button>
              </div>
            </details>
          </div>
        </div>

        <label className="stims-shell__field-label" htmlFor="preset-search">
          Search
        </label>
        <input
          id="preset-search"
          className="stims-shell__input"
          type="search"
          placeholder="Search presets"
          spellCheck={false}
          value={searchQuery}
          onChange={(event) => ui.setSearchQuery(event.target.value)}
        />

        <div className="stims-shell__settings-row">
          <label className="stims-shell__field-label" htmlFor="preset-sort">
            Sort
          </label>
          <select
            id="preset-sort"
            className="stims-shell__select"
            value={sortMode}
            onChange={(event) => {
              const next = event.target.value as SortMode;
              setSortMode(next);
              if (next === 'random') setRandomSeed(Date.now());
              try {
                localStorage.setItem('stims:browse-sort', next);
              } catch {}
            }}
          >
            <option value="relevance">Recommended order</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
            <option value="recent">Recently played</option>
            <option value="favorites-first">Saved first</option>
            <option value="webgpu-supported">WebGPU support</option>
            <option value="random">Randomized</option>
          </select>
        </div>

        <p
          className="stims-shell__active-filters"
          aria-live="polite"
          aria-atomic="true"
        >
          {buildAppliedFilterSummary({
            searchQuery,
            collectionTag: routeState.collectionTag,
          })}
          {searchQuery || routeState.collectionTag ? (
            <button
              type="button"
              className="stims-shell__clear-filters"
              onClick={() => {
                ui.setSearchQuery('');
                onCollectionTagChange(null);
              }}
            >
              Clear
            </button>
          ) : null}
        </p>

        <nav
          className="stims-shell__collections"
          aria-label="Preset collections"
        >
          <button
            type="button"
            className="stims-shell__collection-pill"
            data-active={String(routeState.collectionTag === null)}
            onClick={() => onCollectionTagChange(null)}
          >
            All
          </button>
          {featuredCollectionTags.map((collectionTag) => (
            <button
              key={collectionTag}
              type="button"
              className="stims-shell__collection-pill"
              data-active={String(routeState.collectionTag === collectionTag)}
              onClick={() =>
                onCollectionTagChange(
                  routeState.collectionTag === collectionTag
                    ? null
                    : collectionTag,
                )
              }
            >
              {prettifyCollectionTag(collectionTag)}
            </button>
          ))}
          <button
            type="button"
            className="stims-shell__collection-pill"
            data-active={String(
              routeState.collectionTag === 'collection:community',
            )}
            disabled={offline}
            title={
              offline
                ? 'Community presets need a network connection'
                : undefined
            }
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
          <button
            type="button"
            className="stims-shell__collection-pill"
            data-active={String(visualSearchActive)}
            disabled={visualSearchLoading}
            onClick={() =>
              visualSearchActive
                ? handleDeselectVisualSearch()
                : void handleVisualSearch()
            }
          >
            {visualSearchLoading ? 'Searching\u2026' : 'Similar'}
          </button>
        </nav>
        <div
          className="stims-shell__browse-toolbar-extras"
          data-open={String(showAdvancedFilters)}
        >
          <button
            type="button"
            className="stims-shell__text-button"
            aria-expanded={showAdvancedFilters}
            aria-controls="stims-more-collections"
            onClick={() => {
              setShowAdvancedFilters((current) => !current);
            }}
          >
            Collections
          </button>
          {showAdvancedFilters && hiddenCollectionTags.length > 0 ? (
            <nav
              id="stims-more-collections"
              className="stims-shell__collections"
              aria-label="All collections"
            >
              {hiddenCollectionTags.map((collectionTag) => (
                <button
                  key={collectionTag}
                  type="button"
                  className="stims-shell__collection-pill"
                  data-active={String(
                    routeState.collectionTag === collectionTag,
                  )}
                  onClick={() =>
                    onCollectionTagChange(
                      routeState.collectionTag === collectionTag
                        ? null
                        : collectionTag,
                    )
                  }
                >
                  {prettifyCollectionTag(collectionTag)}
                </button>
              ))}
            </nav>
          ) : showAdvancedFilters ? (
            <p id="stims-more-collections" className="stims-shell__meta-copy">
              No more collections available.
            </p>
          ) : null}
        </div>
      </section>

      {showActivitySections && sessionHistory.length > 0 ? (
        <section className="stims-shell__sheet-surface">
          <div className="stims-shell__section-heading">
            <h2 className="stims-shell__section-label">Session history</h2>
          </div>
          <div className="stims-shell__chip-list">
            {sessionHistory.slice(0, 10).map((item) => (
              <button
                key={`${item.presetId}-${item.at}`}
                type="button"
                className="stims-shell__chip"
                onClick={() => engine.handlePresetSelection(item.presetId)}
              >
                <span className="stims-shell__chip-copy">
                  <strong>{item.title}</strong>
                  <small>{new Date(item.at).toLocaleTimeString()}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {showActivitySections ? (
        <PresetShelfSection
          entries={recentPresets.map((entry) => ({
            entry,
            label: 'Recent',
            summary: '',
          }))}
          summary=""
          title="Recent"
          onSelect={engine.handlePresetSelection}
          onQueue={handleQueuePreset}
          presetPreviews={presetPreviews}
        />
      ) : null}

      {showActivitySections ? (
        <PresetShelfSection
          entries={favoritePresets.map((entry) => ({
            entry,
            label: 'Saved',
            summary: '',
          }))}
          summary=""
          title="Saved"
          onSelect={engine.handlePresetSelection}
          onQueue={handleQueuePreset}
          presetPreviews={presetPreviews}
        />
      ) : null}

      {ui.presetQueue.entries.length > 0 ? (
        <section className="stims-shell__sheet-surface">
          <div className="stims-shell__section-heading">
            <h2 className="stims-shell__section-label">Up next</h2>
          </div>
          <div className="stims-shell__chip-list">
            {ui.presetQueue.entries.map((entry, index) => (
              <div key={entry.id} className="stims-shell__chip">
                <span className="stims-shell__chip-copy">
                  <strong>{entry.title}</strong>
                  <small>Queue position {index + 1}</small>
                </span>
                <button
                  type="button"
                  className="stims-shell__text-button"
                  onClick={() => ui.presetQueue.move(entry.id, -1)}
                  disabled={index === 0}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="stims-shell__text-button"
                  onClick={() => ui.presetQueue.move(entry.id, 1)}
                  disabled={index === ui.presetQueue.entries.length - 1}
                >
                  Down
                </button>
                <button
                  type="button"
                  className="stims-shell__text-button"
                  onClick={() => ui.presetQueue.remove(entry.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="cta-button"
            onClick={playNextQueuedPreset}
          >
            Play next queued preset
          </button>
          <button
            type="button"
            className="stims-shell__text-button"
            onClick={ui.presetQueue.clear}
          >
            Clear queue
          </button>
        </section>
      ) : null}

      <section ref={resultsSectionRef} className="stims-shell__sheet-surface">
        {!catalogReady && !catalogError ? (
          <ul
            className="stims-shell__preset-list"
            style={{ opacity: 0.7 }}
            aria-busy={true}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have fixed order
              <li key={i}>
                <SkeletonPresetCard />
              </li>
            ))}
          </ul>
        ) : null}
        {catalogError ? (
          <p className="stims-shell__meta-copy">{catalogError}</p>
        ) : null}
        {visualSearchActive ? (
          <div className="stims-shell__section-heading">
            <p className="stims-shell__section-label">Similar</p>
            <p className="stims-shell__meta-copy">
              {visualSearchResults.length} result
              {visualSearchResults.length === 1 ? '' : 's'}
            </p>
          </div>
        ) : routeState.collectionTag === 'collection:community' ? (
          <div className="stims-shell__section-heading">
            <p className="stims-shell__section-label">Community</p>
            {communityLoading ? (
              <p className="stims-shell__meta-copy">
                Loading community presets...
              </p>
            ) : communityError ? (
              <div>
                <p className="stims-shell__meta-copy">{communityError}</p>
                <button
                  type="button"
                  className="stims-shell__text-button"
                  onClick={loadCommunityPresets}
                >
                  Retry community presets
                </button>
              </div>
            ) : (
              <p className="stims-shell__meta-copy">
                {communityPresets.length} result
                {communityPresets.length === 1 ? '' : 's'}
              </p>
            )}
          </div>
        ) : (
          <div className="stims-shell__section-heading">
            <p className="stims-shell__section-label">All presets</p>
            <p className="stims-shell__meta-copy">
              {filteredCatalog.length} result
              {filteredCatalog.length === 1 ? '' : 's'}
            </p>
          </div>
        )}
        {visualSearchActive &&
        !visualSearchLoading &&
        visualSearchResults.length === 0 ? (
          <div className="stims-shell__empty-state">
            <strong>No similar presets found</strong>
            <p>Try another visual moment or browse everything.</p>
            <button
              type="button"
              className="cta-button primary"
              onClick={() => void handleVisualSearch()}
            >
              Try again
            </button>
            <button
              type="button"
              className="cta-button"
              onClick={handleDeselectVisualSearch}
            >
              Browse all presets
            </button>
          </div>
        ) : (!visualSearchActive &&
            routeState.collectionTag === 'collection:community' &&
            communityPresets.length === 0) ||
          (!visualSearchActive &&
            routeState.collectionTag !== 'collection:community' &&
            filteredCatalog.length === 0) ? (
          <div className="stims-shell__empty-state">
            <strong>No presets match those filters</strong>
            <p>Try another search or clear filters.</p>
            <button
              type="button"
              className="cta-button primary"
              onClick={() => {
                ui.setSearchQuery('');
                onCollectionTagChange(null);
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <ul className="stims-shell__preset-list">
            {visualSearchActive
              ? visualSearchResults.map((r) => {
                  const entry = catalogEntryById.get(r.presetId);
                  if (!entry) {
                    return (
                      <li key={r.presetId}>
                        <button
                          type="button"
                          className="stims-shell__preset-card"
                          onClick={() =>
                            engine.handlePresetSelection(r.presetId)
                          }
                        >
                          <span className="stims-shell__preset-card-copy">
                            <span className="stims-shell__preset-title">
                              {r.presetId}
                            </span>
                            <span className="stims-shell__preset-vibe">
                              {(r.score * 100).toFixed(0)}% similarity
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  }
                  return (
                    <li key={r.presetId}>
                      <div className="stims-shell__preset-card-wrap">
                        <button
                          type="button"
                          className="stims-shell__preset-card"
                          data-active={String(entry.id === currentPresetId)}
                          onClick={() => engine.handlePresetSelection(entry.id)}
                        >
                          <PresetArtwork
                            entry={entry}
                            compact
                            preview={presetPreviews[entry.id] ?? null}
                          />
                          <span className="stims-shell__preset-card-copy">
                            <span className="stims-shell__preset-title">
                              {entry.title}
                            </span>
                            <span className="stims-shell__preset-vibe">
                              {(r.score * 100).toFixed(0)}% similar ·{' '}
                              {describePresetMood(entry)}
                            </span>
                            <span className="stims-shell__preset-meta">
                              {entry.author || 'Unknown author'}
                            </span>
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })
              : visibleBrowseEntries.map((entry) => {
                  return (
                    <li key={entry.id}>
                      <div className="stims-shell__preset-card-wrap">
                        <button
                          type="button"
                          className="stims-shell__preset-card"
                          data-active={String(entry.id === currentPresetId)}
                          onClick={() => engine.handlePresetSelection(entry.id)}
                        >
                          <PresetArtwork
                            entry={entry}
                            compact
                            preview={presetPreviews[entry.id] ?? null}
                          />
                          <span className="stims-shell__preset-card-copy">
                            <span className="stims-shell__preset-title">
                              {entry.title}
                            </span>
                            <span className="stims-shell__preset-vibe">
                              {describePresetMood(entry)}
                            </span>
                            <span className="stims-shell__preset-meta">
                              {entry.author || 'Unknown author'}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="stims-shell__preset-preview-action"
                          aria-expanded={previewingPresetId === entry.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewingPresetId((current) =>
                              current === entry.id ? null : entry.id,
                            );
                          }}
                        >
                          {previewingPresetId === entry.id
                            ? 'Hide preview'
                            : 'Preview'}
                        </button>
                        <button
                          type="button"
                          className="stims-shell__preset-fav"
                          aria-label={
                            entry.isFavorite
                              ? 'Remove from saved'
                              : 'Save preset'
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            void engine.toggleFavoritePreset(
                              entry.id,
                              !entry.isFavorite,
                            );
                          }}
                        >
                          <span
                            className="stims-shell__preset-fav-icon"
                            data-active={String(entry.isFavorite)}
                            aria-hidden="true"
                          />
                        </button>
                        {previewingPresetId === entry.id ? (
                          <div className="stims-shell__preset-peek">
                            <PresetArtwork
                              entry={entry}
                              preview={presetPreviews[entry.id] ?? null}
                            />
                            <button
                              type="button"
                              className="cta-button primary"
                              onClick={() =>
                                engine.handlePresetSelection(entry.id)
                              }
                            >
                              Load this preset
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
          </ul>
        )}
        {hiddenBrowseEntryCount > 0 && !visualSearchActive ? (
          <div className="stims-shell__preset-list-more">
            <button
              type="button"
              className="stims-shell__text-button"
              onClick={() => {
                setVisibleCatalogState((current) => {
                  const currentLimit =
                    current.key === browseResetKey
                      ? current.limit
                      : BROWSE_RESULT_BATCH_SIZE;
                  return {
                    key: browseResetKey,
                    limit: Math.min(
                      currentLimit + BROWSE_RESULT_BATCH_SIZE,
                      sortedBrowseEntries.length,
                    ),
                  };
                });
              }}
            >
              Show more presets
            </button>
            <p className="stims-shell__meta-copy">
              Showing {visibleBrowseEntries.length} of{' '}
              {sortedBrowseEntries.length}.
            </p>
          </div>
        ) : null}

        <div className="stims-shell__session-actions">
          <button
            type="button"
            className="cta-button"
            onClick={engine.exportPreset}
          >
            Download current preset
          </button>
          <label className="cta-button stims-shell__file-button">
            Add preset file
            <input
              type="file"
              accept=".milk,.txt,text/plain"
              multiple
              onChange={(event) => handleImportFiles(event.target.files)}
            />
          </label>
          <label
            className="cta-button stims-shell__file-button"
            aria-disabled={imageImportLoading}
          >
            {imageImportLoading
              ? 'Importing\u2026'
              : offline
                ? 'Image creation offline'
                : 'Create preset from image'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={imageImportLoading || offline}
              onChange={(event) => void handleImageImport(event.target.files)}
            />
          </label>
          <label
            className="cta-button stims-shell__file-button"
            aria-disabled={imageImportLoading || offline}
          >
            Camera vibe
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={imageImportLoading || offline}
              onChange={(event) => void handleImageImport(event.target.files)}
            />
          </label>
          <button
            type="button"
            className="cta-button"
            onClick={() => void ui.handleShowCurrentLink()}
          >
            Copy share link
          </button>
        </div>
        <p
          className="stims-shell__meta-copy"
          aria-live="polite"
          aria-atomic="true"
        >
          {imageImportLoading
            ? 'Importing image…'
            : imageImportResult
              ? 'Image preset created.'
              : fileImportStatus}
        </p>
        {imageImportResult ? (
          <div className="stims-shell__image-import-result">
            <p className="stims-shell__section-label">Created preset</p>
            <p className="stims-shell__meta-copy">
              {imageImportResult.description}
            </p>
            <p className="stims-shell__meta-copy">
              Preset: {imageImportResult.label}
            </p>
          </div>
        ) : null}
      </section>

      <nav
        className="stims-shell__thumb-actions"
        aria-label="Thumb mode quick actions"
      >
        <button
          type="button"
          className="stims-shell__text-button"
          onClick={engine.handleShufflePreset}
        >
          Surprise me
        </button>
        <button
          type="button"
          className="stims-shell__text-button"
          onClick={() => ui.setSearchQuery('')}
          disabled={!searchQuery}
        >
          Clear search
        </button>
        <button
          type="button"
          className="stims-shell__text-button"
          onClick={() => void ui.handleShowCurrentLink()}
        >
          Share
        </button>
      </nav>
    </div>
  );
}
