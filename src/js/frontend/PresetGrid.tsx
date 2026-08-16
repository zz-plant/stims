import { useEffect, useRef, useState } from 'react';
import type { AudioSource, PresetCatalogEntry } from './contracts.ts';
import { usePresetPreviews } from './hooks/use-preset-previews.ts';
import { PresetArtwork } from './PresetArtwork.tsx';

const GRID_COLS = 3;
const GRID_ROWS = 4;
const GRID_VISIBLE = GRID_COLS * GRID_ROWS;

export function PresetGrid({
  catalogEntries,
  routeState,
  setRouteState,
}: {
  catalogEntries: PresetCatalogEntry[];
  routeState: { presetId: string | null; audioSource: AudioSource | null };
  setRouteState: (next: {
    presetId: string | null;
    audioSource: AudioSource | null;
  }) => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const { presetPreviews, requestPresetPreviews } = usePresetPreviews({
    stageRef,
    engine: {
      pausePreview: () => {},
      resumePreview: () => {},
    },
    engineSnapshot: null,
    fallbackCatalogReady: false,
    isDisposed: () => false,
  });

  const [readySet, setReadySet] = useState<Set<string>>(new Set());

  // Request previews for visible entries on mount
  useEffect(() => {
    const ids = catalogEntries.slice(0, GRID_VISIBLE).map((e) => e.id);
    requestPresetPreviews(ids);
  }, [catalogEntries, requestPresetPreviews]);

  // Track which previews are ready
  useEffect(() => {
    const ready = new Set(
      catalogEntries
        .filter((e) => presetPreviews[e.id]?.status === 'ready')
        .map((e) => e.id),
    );
    setReadySet(ready);
  }, [catalogEntries, presetPreviews]);

  const handleItemClick = (id: string) => {
    if (!presetPreviews[id]?.imageUrl && !readySet.has(id)) {
      requestPresetPreviews([id]);
    }
    setRouteState({ presetId: id, audioSource: routeState.audioSource });
  };

  const handleItemHover = (id: string) => {
    if (!presetPreviews[id]?.imageUrl && !readySet.has(id)) {
      requestPresetPreviews([id]);
    }
  };

  return (
    <section className="stims-preset-grid" aria-label="Preset grid">
      {catalogEntries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="stims-preset-grid__item"
          aria-label={entry.title || entry.id}
          onPointerEnter={() => handleItemHover(entry.id)}
          onFocus={() => handleItemHover(entry.id)}
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
