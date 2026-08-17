import { useEffect, useRef } from 'react';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type { AudioSource, PresetCatalogEntry } from './contracts.ts';
import { PresetArtwork } from './PresetArtwork.tsx';

const GRID_COLS = 3;
const GRID_ROWS = 4;
const GRID_VISIBLE = GRID_COLS * GRID_ROWS;

export function PresetGrid({
  catalogEntries,
  presetPreviews,
  requestPresetPreviews,
  routeState,
  setRouteState,
}: {
  catalogEntries: PresetCatalogEntry[];
  presetPreviews: Record<string, MilkdropPresetRenderPreview>;
  requestPresetPreviews: (presetIds: string[]) => void | Promise<void>;
  routeState: { presetId: string | null; audioSource: AudioSource | null };
  setRouteState: (next: {
    presetId: string | null;
    audioSource: AudioSource | null;
  }) => void;
}) {
  // The context request function changes identity on every session render;
  // keep the latest behind a ref so the mount effect only fires on catalog
  // changes, not on every re-render.
  const requestPresetPreviewsRef = useRef(requestPresetPreviews);
  requestPresetPreviewsRef.current = requestPresetPreviews;

  // Request runtime previews for the visible tiles on mount / catalog change.
  // Every tile already shows its static thumbnail in the meantime.
  useEffect(() => {
    const ids = catalogEntries.slice(0, GRID_VISIBLE).map((e) => e.id);
    void requestPresetPreviewsRef.current(ids);
  }, [catalogEntries]);

  const requestIfMissing = (id: string) => {
    if (presetPreviews[id]?.status !== 'ready') {
      void requestPresetPreviewsRef.current([id]);
    }
  };

  const handleItemClick = (id: string) => {
    requestIfMissing(id);
    setRouteState({ presetId: id, audioSource: routeState.audioSource });
  };

  return (
    <section className="stims-preset-grid" aria-label="Preset grid">
      {catalogEntries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="stims-preset-grid__item"
          aria-label={entry.title || entry.id}
          onPointerEnter={() => requestIfMissing(entry.id)}
          onFocus={() => requestIfMissing(entry.id)}
          onClick={() => handleItemClick(entry.id)}
        >
          <PresetArtwork
            entry={entry}
            preview={presetPreviews[entry.id] ?? null}
          />
          <div className="stims-preset-grid__meta">
            <span className="stims-preset-grid__title">{entry.title}</span>
          </div>
        </button>
      ))}

      {catalogEntries.length < GRID_VISIBLE && (
        <div
          className="stims-preset-grid__spacer"
          style={{
            height: `calc(100% / ${GRID_ROWS} * ${
              GRID_ROWS - (catalogEntries.length % GRID_COLS || GRID_COLS) - 1
            })`,
            width: '100%',
          }}
        />
      )}
    </section>
  );
}
