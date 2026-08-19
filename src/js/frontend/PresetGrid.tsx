import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type { AudioSource, PresetCatalogEntry } from './contracts.ts';
import { useListKeyboardNav } from './hooks/use-list-keyboard-nav.ts';
import { PresetIdentity } from './PresetIdentity.tsx';

/**
 * One tile, memoized: an audition (hover) state change on the grid must only
 * re-render the two tiles whose `audition` prop actually flipped — a plain
 * inline map re-rendered every tile in the catalog per hover, which was the
 * grid's dominant pointer-move hitch.
 */
const GridTile = memo(function GridTile({
  entry,
  preview,
  variants,
  audition,
  onAudition,
  onAuditionEnd,
  onOpen,
}: {
  entry: PresetCatalogEntry;
  preview: MilkdropPresetRenderPreview | null;
  variants: number;
  audition: boolean;
  onAudition: (id: string) => void;
  onAuditionEnd: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="stims-preset-grid__item"
      data-preset-id={entry.id}
      aria-label={
        variants > 0
          ? `${entry.title || entry.id} (+${variants} near-identical variant${variants === 1 ? '' : 's'})`
          : entry.title || entry.id
      }
      onPointerEnter={() => onAudition(entry.id)}
      onPointerLeave={() => onAuditionEnd(entry.id)}
      onFocus={() => onAudition(entry.id)}
      onBlur={() => onAuditionEnd(entry.id)}
      onClick={() => onOpen(entry.id)}
    >
      <PresetIdentity entry={entry} preview={preview} audition={audition} />
      {variants > 0 ? (
        <span
          className="stims-preset-grid__variants"
          title={`${variants} near-identical variant${variants === 1 ? '' : 's'} (see list view)`}
        >
          +{variants}
        </span>
      ) : null}
    </button>
  );
});

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

  // Same roving pattern as the list view: one Tab stop for the whole grid,
  // arrows/Home/End move between tiles — otherwise every tile is its own
  // Tab stop and reaching the Nth costs N presses.
  useListKeyboardNav(gridRef, {
    itemSelector: '.stims-preset-grid__item',
    orientation: 'grid',
    deps: [catalogEntries],
  });

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
      // Cap per flush: a screenful is ~12 tiles; anything beyond that came
      // from a scroll jump and will re-observe if it's still visible.
      const ids = [...pending].slice(0, 12);
      pending.clear();
      void requestPresetPreviewsRef.current(ids);
    };
    const observer = new IntersectionObserver(
      (intersections) => {
        for (const intersection of intersections) {
          const id = (intersection.target as HTMLElement).dataset.presetId;
          if (!id) continue;
          if (!intersection.isIntersecting) {
            // Tiles flung past during a fast scroll leave before the flush
            // fires; requesting previews for them is pure wasted engine work.
            pending.delete(id);
            continue;
          }
          if (presetPreviewsRef.current[id]?.status === 'ready') continue;
          pending.add(id);
        }
        if (pending.size > 0 && flushTimer === null) {
          flushTimer = window.setTimeout(flush, 300);
        }
      },
      { root: null, rootMargin: '150px' },
    );
    for (const tile of grid.querySelectorAll('[data-preset-id]')) {
      observer.observe(tile);
    }
    return () => {
      observer.disconnect();
      if (flushTimer !== null) window.clearTimeout(flushTimer);
    };
  }, [visibleEntries]);

  const routeStateRef = useRef(routeState);
  routeStateRef.current = routeState;
  const setRouteStateRef = useRef(setRouteState);
  setRouteStateRef.current = setRouteState;

  // Stable identities so GridTile's memo holds across grid re-renders.
  // Hover intent: auditioning spins up a real engine tile (compile + mount),
  // so it only starts after a sustained hover — a pointer sweeping across
  // the grid must not ignite an engine per tile it crosses.
  const auditionIntentRef = useRef<{ id: string; timer: number } | null>(null);
  const handleAudition = useCallback((id: string) => {
    const pending = auditionIntentRef.current;
    if (pending?.id === id) return;
    if (pending) window.clearTimeout(pending.timer);
    auditionIntentRef.current = {
      id,
      timer: window.setTimeout(() => {
        auditionIntentRef.current = null;
        setAuditionId((current) => (current === id ? current : id));
      }, 250),
    };
  }, []);
  // Clear only if this tile still owns the audition (or its pending intent):
  // enter(new) can fire before leave(old), and an unconditional clear would
  // kill the new one.
  const handleAuditionEnd = useCallback((id: string) => {
    const pending = auditionIntentRef.current;
    if (pending?.id === id) {
      window.clearTimeout(pending.timer);
      auditionIntentRef.current = null;
    }
    setAuditionId((current) => (current === id ? null : current));
  }, []);
  useEffect(
    () => () => {
      if (auditionIntentRef.current) {
        window.clearTimeout(auditionIntentRef.current.timer);
      }
    },
    [],
  );
  const handleOpen = useCallback((id: string) => {
    if (presetPreviewsRef.current[id]?.status !== 'ready') {
      void requestPresetPreviewsRef.current([id]);
    }
    setRouteStateRef.current({
      presetId: id,
      audioSource: routeStateRef.current.audioSource,
    });
  }, []);

  return (
    <section
      ref={gridRef}
      className="stims-preset-grid"
      aria-label="Preset grid"
    >
      {visibleEntries.map((entry) => (
        <GridTile
          key={entry.id}
          entry={entry}
          preview={presetPreviews[entry.id] ?? null}
          variants={variantCounts.get(entry.id) ?? 0}
          audition={auditionId === entry.id}
          onAudition={handleAudition}
          onAuditionEnd={handleAuditionEnd}
          onOpen={handleOpen}
        />
      ))}
    </section>
  );
}
