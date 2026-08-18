import { useEffect, useMemo, useRef, useState } from 'react';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type { AudioSource, PresetCatalogEntry } from './contracts.ts';
import { PresetArtwork } from './PresetArtwork.tsx';

/**
 * Grid browse view.
 *
 * Receives the full sorted result set: offscreen tiles cost nothing to lay
 * out or paint (`content-visibility: auto` in app-shell.css), so no
 * pagination is needed here. Preview requests are viewport-driven — an
 * IntersectionObserver batches requests for tiles as they approach, instead
 * of only the first screenful on mount.
 *
 * Near-duplicate collapse: entries annotated by dedup-catalog.ts as
 * non-representative cluster members fold into their representative's tile,
 * which shows a "+N" variant badge. The full set of variants stays reachable
 * through the list view; the grid optimizes for visual variety per screen.
 */
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
  // keep the latest behind a ref so observers never re-subscribe over it.
  const requestPresetPreviewsRef = useRef(requestPresetPreviews);
  requestPresetPreviewsRef.current = requestPresetPreviews;
  const presetPreviewsRef = useRef(presetPreviews);
  presetPreviewsRef.current = presetPreviews;

  const gridRef = useRef<HTMLElement | null>(null);
  const [auditionId, setAuditionId] = useState<string | null>(null);

  const { visibleEntries, variantCounts } = useMemo(() => {
    const present = new Set(catalogEntries.map((entry) => entry.id));
    const counts = new Map<string, number>();
    const kept: PresetCatalogEntry[] = [];
    for (const entry of catalogEntries) {
      const representative = entry.similarity?.duplicateOf;
      if (representative && present.has(representative)) {
        counts.set(representative, (counts.get(representative) ?? 0) + 1);
        continue;
      }
      kept.push(entry);
    }
    return { visibleEntries: kept, variantCounts: counts };
  }, [catalogEntries]);

  // Viewport-driven preview requests: batch ids that scroll near the
  // viewport and request them together once per idle tick.
  // biome-ignore lint/correctness/useExhaustiveDependencies: visibleEntries drives re-observation after the DOM tile set changes; the effect reads tiles from the DOM, not the array
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof IntersectionObserver === 'undefined') return;
    const pending = new Set<string>();
    let flushTimer: number | null = null;
    const flush = () => {
      flushTimer = null;
      if (pending.size === 0) return;
      const ids = [...pending];
      pending.clear();
      void requestPresetPreviewsRef.current(ids);
    };
    const observer = new IntersectionObserver(
      (intersections) => {
        for (const intersection of intersections) {
          if (!intersection.isIntersecting) continue;
          const id = (intersection.target as HTMLElement).dataset.presetId;
          if (!id) continue;
          if (presetPreviewsRef.current[id]?.status === 'ready') continue;
          pending.add(id);
        }
        if (pending.size > 0 && flushTimer === null) {
          flushTimer = window.setTimeout(flush, 150);
        }
      },
      { root: null, rootMargin: '300px' },
    );
    for (const tile of grid.querySelectorAll('[data-preset-id]')) {
      observer.observe(tile);
    }
    return () => {
      observer.disconnect();
      if (flushTimer !== null) window.clearTimeout(flushTimer);
    };
  }, [visibleEntries]);

  const handleItemClick = (id: string) => {
    if (presetPreviewsRef.current[id]?.status !== 'ready') {
      void requestPresetPreviewsRef.current([id]);
    }
    setRouteState({ presetId: id, audioSource: routeState.audioSource });
  };

  return (
    <section
      ref={gridRef}
      className="stims-preset-grid"
      aria-label="Preset grid"
    >
      {visibleEntries.map((entry) => {
        const variants = variantCounts.get(entry.id) ?? 0;
        return (
          <button
            key={entry.id}
            type="button"
            className="stims-preset-grid__item"
            data-preset-id={entry.id}
            aria-label={entry.title || entry.id}
            onPointerEnter={() => setAuditionId(entry.id)}
            onPointerLeave={() =>
              setAuditionId((current) =>
                current === entry.id ? null : current,
              )
            }
            onFocus={() => setAuditionId(entry.id)}
            onBlur={() =>
              setAuditionId((current) =>
                current === entry.id ? null : current,
              )
            }
            onClick={() => handleItemClick(entry.id)}
          >
            <PresetArtwork
              entry={entry}
              preview={presetPreviews[entry.id] ?? null}
              audition={auditionId === entry.id}
            />
            {variants > 0 ? (
              <span
                className="stims-preset-grid__variants"
                title={`${variants} near-identical variant${variants === 1 ? '' : 's'} (see list view)`}
              >
                +{variants}
              </span>
            ) : null}
            <div className="stims-preset-grid__meta">
              <span className="stims-preset-grid__title">{entry.title}</span>
            </div>
          </button>
        );
      })}
    </section>
  );
}
