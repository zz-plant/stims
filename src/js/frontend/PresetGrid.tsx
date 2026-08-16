import { useEffect, useRef, useState } from 'react';
import type { PresetCatalogEntry } from './contracts.ts';
import { usePresetPreviews } from './hooks/use-preset-previews.ts';

const GRID_COLS = 3;
const GRID_ROWS = 4;
const GRID_VISIBLE = GRID_COLS * GRID_ROWS;

export function PresetGrid({
  catalogEntries,
  routeState,
  setRouteState,
}: {
  catalogEntries: PresetCatalogEntry[];
  routeState: { presetId: string | null; audioSource: string | null };
  setRouteState: (next: {
    presetId: string | null;
    audioSource: string | null;
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
    const ids = catalogEntries
      .slice(0, GRID_VISIBLE)
      .map((e) => e.id);
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
    // Ensure preview is requested (will be queued if already in flight)
    if (!presetPreviews[id]?.imageUrl && !readySet.has(id)) {
      requestPresetPreviews([id]);
    }
    // Commit preset — audio source stays unchanged
    setRouteState({ presetId: id, audioSource: routeState.audioSource });
  };

  const handleItemMouseOver = (id: string) => {
    if (!presetPreviews[id]?.imageUrl && !readySet.has(id)) {
      requestPresetPreviews([id]);
    }
  };

  const handleItemMouseOut = () => {};

  return (
    <div
      className="stims-preset-grid"
      role="grid"
      aria-label="Preset gallery"
    >
      {catalogEntries.map((entry, idx) => {
        const preview = presetPreviews[entry.id];
        const isReady =
          readySet.has(entry.id) || preview?.status === 'ready';

        return (
          <div
            key={entry.id}
            className="stims-preset-grid__item"
            role="gridcell"
            aria-rowindex={Math.floor(idx / GRID_COLS) + 1}
            aria-colindex={(idx % GRID_COLS) + 1}
            onMouseOver={() => handleItemMouseOver(entry.id)}
            onMouseOut={handleItemMouseOut}
            onClick={() => handleItemClick(entry.id)}
          >
            {isReady && preview?.imageUrl ? (
              <img
                src={preview.imageUrl}
                alt={entry.title}
                className="stims-preset-grid__thumbnail"
                width={200}
                height={150}
              />
            ) : (
              <div
                className="stims-preset-grid__placeholder"
                style={{
                  background: '#1a1a2e',
                  color: '#888',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                }}
              >
                {entry.title ? (
                  <span
                    className="stims-preset-grid__title"
                    style={{
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '100%',
                    }}
                  >
                    {entry.title}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        );
      })}

      {catalogEntries.length < GRID_VISIBLE && (
        <div
          className="stims-preset-grid__spacer"
          style={{
            height: `calc(100% / ${GRID_ROWS} * ${
              GRID_ROWS -
                (catalogEntries.length % GRID_COLS || GRID_COLS) -
                1
            })`,
            width: '100%',
          }}
        />
      )}
    </div>
  );
}