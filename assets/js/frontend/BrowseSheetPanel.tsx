import { useEffect, useMemo, useRef, useState } from 'react';
import type { PresetCatalogEntry } from './contracts.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import { SkeletonPresetCard } from './PresetShelfSection.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';
import {
  buildAppliedFilterSummary,
  describePresetMood,
  getFeaturedCollectionTags,
  prettifyCollectionTag,
} from './workspace-helpers.ts';

const BATCH_SIZE = 30;
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
    return (
      (localStorage.getItem('stims:browse-sort') as SortMode) ?? 'relevance'
    );
  } catch {
    return 'relevance';
  }
}

function sortEntries(
  entries: PresetCatalogEntry[],
  sort: SortMode,
  seed: number,
) {
  const sorted = [...entries];
  switch (sort) {
    case 'title':
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case 'author':
      return sorted.sort((a, b) =>
        (a.author ?? 'Unknown').localeCompare(b.author ?? 'Unknown'),
      );
    case 'recent':
      return sorted.sort(
        (a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0),
      );
    case 'favorites-first':
      return sorted.sort(
        (a, b) => Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite)),
      );
    case 'webgpu-supported':
      return sorted.sort(
        (a, b) =>
          Number(Boolean(b.supports?.webgpu)) -
          Number(Boolean(a.supports?.webgpu)),
      );
    case 'random':
      return sorted.sort((a, b) =>
        `${a.id}:${seed}`.localeCompare(`${b.id}:${seed}`),
      );
    default:
      return sorted;
  }
}

export function BrowseSheetPanel({
  onCollectionTagChange,
  onImport: _onImport,
  offline = false,
  sessionHistory: _sessionHistory = [],
}: {
  onCollectionTagChange: (tag: string | null) => void;
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
  const filteredCatalog = engine.filteredCatalog;
  const presetPreviews = engine.presetPreviews;
  const routeState = ui.routeState;
  const searchQuery = ui.searchQuery;

  const [sortMode, setSortMode] = useState<SortMode>(readSortMode);
  const [randomSeed, setRandomSeed] = useState(() => Date.now());
  const [limit, setLimit] = useState(BATCH_SIZE);
  const resultsRef = useRef<HTMLElement | null>(null);

  const featuredTags = getFeaturedCollectionTags(collectionTags);
  const hasFilter =
    searchQuery.trim().length > 0 || routeState.collectionTag !== null;

  const browseEntries =
    routeState.collectionTag === 'collection:community'
      ? engine.filteredCatalog
      : filteredCatalog;
  const sorted = useMemo(
    () => sortEntries(browseEntries, sortMode, randomSeed),
    [browseEntries, sortMode, randomSeed],
  );
  const visible = sorted.slice(0, limit);
  const hiddenCount = sorted.length - visible.length;

  // Reset pagination when filters change
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset limit on filter changes
  useEffect(() => {
    setLimit(BATCH_SIZE);
  }, [searchQuery, routeState.collectionTag]);

  return (
    <div className="stims-shell__sheet-panel stims-shell__sheet-panel--browse">
      <section className="stims-shell__sheet-surface stims-shell__sheet-surface--sticky">
        <div className="stims-shell__browse-toolbar">
          <strong>Browse presets</strong>
          <button
            type="button"
            className="stims-shell__text-button"
            onClick={engine.handleShufflePreset}
            disabled={catalog.length === 0}
          >
            Surprise me
          </button>
        </div>

        <div className="stims-shell__browse-search-row">
          <input
            id="preset-search"
            className="stims-shell__input"
            type="search"
            placeholder="Search presets"
            spellCheck={false}
            value={searchQuery}
            onChange={(e) => ui.setSearchQuery(e.target.value)}
          />
          <select
            className="stims-shell__select stims-shell__browse-sort"
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
            <option value="recent">Recent</option>
            <option value="favorites-first">Saved</option>
            <option value="webgpu-supported">WebGPU</option>
            <option value="random">Random</option>
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
          {hasFilter ? (
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
          {featuredTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="stims-shell__collection-pill"
              data-active={String(routeState.collectionTag === tag)}
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
            className="stims-shell__collection-pill"
            data-active={String(
              routeState.collectionTag === 'collection:community',
            )}
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
      </section>

      <section ref={resultsRef} className="stims-shell__sheet-surface">
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
          <p className="stims-shell__meta-copy">{catalogError}</p>
        ) : null}

        <div className="stims-shell__section-heading">
          <p className="stims-shell__section-label">
            {routeState.collectionTag === 'collection:community'
              ? 'Community'
              : 'All presets'}
          </p>
          <p className="stims-shell__meta-copy">
            {sorted.length} result{sorted.length === 1 ? '' : 's'}
          </p>
        </div>

        {sorted.length === 0 && catalogReady ? (
          <div className="stims-shell__empty-state">
            <strong>No presets match</strong>
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
            {visible.map((entry) => (
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
            ))}
          </ul>
        )}

        {hiddenCount > 0 ? (
          <div className="stims-shell__preset-list-more">
            <button
              type="button"
              className="stims-shell__text-button"
              onClick={() => setLimit((l) => l + BATCH_SIZE)}
            >
              Show more
            </button>
            <p className="stims-shell__meta-copy">
              Showing {visible.length} of {sorted.length}
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
