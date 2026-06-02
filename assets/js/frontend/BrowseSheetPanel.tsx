import { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    if (routeState.collectionTag === 'collection:community') {
      setCommunityLoading(true);
      setCommunityError(null);
      fetch('/api/presets?sort=top&limit=20')
        .then((res) => res.json())
        .then((data) => {
          setCommunityPresets(data.presets || []);
          setCommunityLoading(false);
        })
        .catch((err: Error) => {
          setCommunityError(err.message);
          setCommunityLoading(false);
        });
    }
  }, [routeState.collectionTag]);

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
      ui.setStatusMessage('Visual search failed.');
    } finally {
      setVisualSearchLoading(false);
    }
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
    engine.requestPresetPreviews(visiblePreviewIds);
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
            <strong>Select a preset and press play.</strong>
            <p className="stims-shell__meta-copy">
              Tap any card to play it. Previews update as they finish loading.
            </p>
          </div>
          <div className="stims-shell__browse-toolbar-actions">
            <button
              type="button"
              className="stims-shell__text-button"
              onClick={engine.handleShufflePreset}
              disabled={catalog.length === 0}
            >
              Shuffle
            </button>
            <details className="stims-shell__browse-toolbar-extras">
              <summary
                className="stims-shell__text-button"
                aria-label="More browse tools"
              >
                More
              </summary>
              <div className="stims-shell__browse-toolbar-extras-body">
                <p
                  className="stims-shell__meta-copy"
                  data-testid="browse-preview-summary"
                >
                  Previews: {previewSummary || 'waiting on captures'}
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
          placeholder="Search by title, mood, creator, or collection"
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
        </p>

        <nav
          className="stims-shell__collections"
          aria-label="Popular collections"
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
            {visualSearchLoading ? 'Searching\u2026' : 'Visual search'}
          </button>
        </nav>
        <div
          className="stims-shell__browse-toolbar-extras"
          data-open={String(showAdvancedFilters)}
        >
          <button
            type="button"
            className="stims-shell__text-button"
            onClick={() => {
              setShowAdvancedFilters((current) => !current);
            }}
          >
            Advanced filters
          </button>
          {showAdvancedFilters && hiddenCollectionTags.length > 0 ? (
            <nav
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
            <p className="stims-shell__meta-copy">No additional filters.</p>
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
            <p className="stims-shell__section-label">Visual search</p>
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
              <p className="stims-shell__meta-copy">{communityError}</p>
            ) : (
              <p className="stims-shell__meta-copy">
                {communityPresets.length} result
                {communityPresets.length === 1 ? '' : 's'}
              </p>
            )}
          </div>
        ) : (
          <div className="stims-shell__section-heading">
            <p className="stims-shell__section-label">Everything</p>
            <p className="stims-shell__meta-copy">
              {filteredCatalog.length} result
              {filteredCatalog.length === 1 ? '' : 's'}
              ready to explore.
            </p>
          </div>
        )}
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
            : (routeState.collectionTag === 'collection:community'
                ? communityPresets
                : filteredCatalog
              ).map((entry) => {
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
                          <span className="stims-shell__meta-copy">
                            {formatPresetSupportNote(entry)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="stims-shell__preset-fav"
                        aria-label={
                          entry.isFavorite ? 'Remove from saved' : 'Save preset'
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

        <div className="stims-shell__session-actions">
          <button
            type="button"
            className="cta-button"
            onClick={engine.exportPreset}
          >
            Export preset
          </button>
          <label className="cta-button stims-shell__file-button">
            Import preset
            <input
              type="file"
              accept=".milk,.txt,text/plain"
              multiple
              onChange={(event) => onImport(event.target.files)}
            />
          </label>
          <label className="cta-button stims-shell__file-button">
            {imageImportLoading ? 'Importing\u2026' : 'Import from image'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => void handleImageImport(event.target.files)}
            />
          </label>
          <button
            type="button"
            className="cta-button"
            onClick={() => void ui.handleShowCurrentLink()}
          >
            Copy link
          </button>
        </div>
        {imageImportResult ? (
          <div className="stims-shell__image-import-result">
            <p className="stims-shell__section-label">Import result</p>
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
