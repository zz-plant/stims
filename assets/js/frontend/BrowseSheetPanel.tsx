import { useCallback, useEffect, useMemo, useState } from 'react';
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
  formatPresetSupportNote,
  getFeaturedCollectionTags,
  getPresetCardSupportLabel,
  prettifyCollectionTag,
} from './workspace-helpers.ts';

const BROWSE_RESULT_BATCH_SIZE = 24;

export function BrowseSheetPanel({
  onCollectionTagChange,
  onImport,
}: {
  onCollectionTagChange: (collectionTag: string | null) => void;
  onImport: (files: FileList | null) => void;
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
    presetId: string;
  } | null>(null);
  const [imageImportLoading, setImageImportLoading] = useState(false);
  const [fileImportStatus, setFileImportStatus] = useState('');
  const [visibleCatalogState, setVisibleCatalogState] = useState({
    key: '',
    limit: BROWSE_RESULT_BATCH_SIZE,
  });

  const handleImageImport = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const formData = new FormData();
    formData.append('image', file);

    setImageImportLoading(true);
    setImageImportResult(null);
    try {
      const res = await fetch('/api/image-to-preset', {
        method: 'POST',
        body: formData,
      });
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
      const data = (await res.json()) as {
        description: string;
        presetId: string;
      };
      setImageImportResult(data);
      if (data.presetId) {
        engine.handlePresetSelection(data.presetId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      ui.setStatusMessage(`Image import failed: ${message}`);
    } finally {
      setImageImportLoading(false);
    }
  };

  const loadCommunityPresets = useCallback(() => {
    setCommunityLoading(true);
    setCommunityError(null);
    fetch('/api/presets?sort=top&limit=20')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Unable to load community presets (${res.status}).`);
        }
        return res.json();
      })
      .then((data) => {
        const presets = Array.isArray(data.presets) ? data.presets : [];
        setCommunityPresets(presets);
        setCommunityLoading(false);
      })
      .catch((err: Error) => {
        setCommunityError(err.message);
        setCommunityLoading(false);
      });
  }, []);

  useEffect(() => {
    if (routeState.collectionTag === 'collection:community') {
      loadCommunityPresets();
    }
  }, [routeState.collectionTag, loadCommunityPresets]);

  const handleVisualSearch = async () => {
    const canvas = ui.stageRef.current?.querySelector(
      'canvas',
    ) as HTMLCanvasElement | null;
    if (!canvas) {
      ui.setStatusMessage('No visual frame available yet.');
      return;
    }
    setVisualSearchLoading(true);
    setVisualSearchActive(true);
    try {
      const results = await searchByFrame(canvas);
      setVisualSearchResults(results);
    } catch {
      ui.setStatusMessage('Finding similar presets failed.');
    } finally {
      setVisualSearchLoading(false);
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

  const showStarterPresets =
    searchQuery.trim().length === 0 && routeState.collectionTag === null;
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
  const visibleBrowseEntries =
    routeState.collectionTag === 'collection:community'
      ? browseEntries
      : browseEntries.slice(0, visibleCatalogLimit);
  const hiddenBrowseEntryCount =
    browseEntries.length - visibleBrowseEntries.length;
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

  return (
    <div className="stims-shell__sheet-panel stims-shell__sheet-panel--browse">
      <section className="stims-shell__sheet-surface stims-shell__sheet-surface--sticky">
        <div className="stims-shell__browse-toolbar">
          <div className="stims-shell__browse-toolbar-copy">
            <strong>Choose a preset to start playing.</strong>
            <p className="stims-shell__meta-copy">
              Tap any card to load it on the stage. Thumbnail previews fill in
              as they are ready.
            </p>
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
                aria-label="Preview tools"
              >
                Preview tools
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
          placeholder="Search presets by title, creator, mood, or collection"
          spellCheck={false}
          value={searchQuery}
          onChange={(event) => ui.setSearchQuery(event.target.value)}
        />

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
              Clear search
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
            {visualSearchLoading
              ? 'Searching\u2026'
              : 'Find similar to current look'}
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
            More collections
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
          presetPreviews={presetPreviews}
        />
      ) : null}

      <section className="stims-shell__sheet-surface">
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
            <p className="stims-shell__section-label">
              Find similar to current look
            </p>
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
              available.
            </p>
          </div>
        )}
        {visualSearchActive &&
        !visualSearchLoading &&
        visualSearchResults.length === 0 ? (
          <div className="stims-shell__empty-state">
            <strong>No similar presets found</strong>
            <p>
              The current frame may not have a close match yet. Try another
              moment in the visualizer or browse everything instead.
            </p>
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
            <p>
              Try a different search, choose another collection, or clear the
              filters.
            </p>
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
              ? visualSearchResults.map((r) => (
                  <li key={r.presetId}>
                    <button
                      type="button"
                      className="stims-shell__preset-card"
                      onClick={() => engine.handlePresetSelection(r.presetId)}
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
                ))
              : visibleBrowseEntries.map((entry) => {
                  const supportLabel = getPresetCardSupportLabel(entry);

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
                            <span className="stims-shell__preset-meta-row">
                              <span className="stims-shell__preset-meta">
                                {entry.author || 'Unknown author'}
                              </span>
                              {supportLabel ? (
                                <span className="stims-shell__preset-tech">
                                  {supportLabel}
                                </span>
                              ) : null}
                            </span>
                            <span className="stims-shell__preset-tech-badges">
                              {entry.supports?.webgpu ? (
                                <span className="tech-badge webgpu">
                                  WebGPU
                                </span>
                              ) : null}
                              {entry.supports?.webgl ? (
                                <span className="tech-badge webgl">WebGL</span>
                              ) : null}
                              <span className="tech-badge audio">Audio</span>
                            </span>
                            <span className="stims-shell__meta-copy">
                              {formatPresetSupportNote(entry)}
                            </span>
                          </span>
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
                      browseEntries.length,
                    ),
                  };
                });
              }}
            >
              Show more presets
            </button>
            <p className="stims-shell__meta-copy">
              Showing {visibleBrowseEntries.length} of {browseEntries.length}.
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
              : 'Create preset from image'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={imageImportLoading}
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
              Preset: {imageImportResult.presetId}
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
