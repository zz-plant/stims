import { useVirtualizer } from '@tanstack/react-virtual';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type { AudioSource, PresetCatalogEntry } from './contracts.ts';
import { PresetIdentity } from './PresetIdentity.tsx';

/** Column sizing. Rows carry their own inline `grid-template-columns` built
 * from the count derived here, so this — not the CSS — is the single source
 * of truth for how wide a tile gets.
 *
 * The narrow minimum exists because a single `auto-fill` minimum cannot serve
 * both ends: 132px yields a sensible 3-up in the default ~527px panel, but
 * anything under 272px collapses to ONE column, at which point "grid view" is
 * just the list with bigger art and twice the scrolling. Lowering the single
 * minimum instead would have shrunk the default panel to a 5-up of small
 * tiles, so the minimum steps down only once the panel is genuinely narrow. */
const GRID_MIN_COLUMN_PX = 132;
const GRID_NARROW_MIN_COLUMN_PX = 96;
const GRID_NARROW_PANEL_PX = 280;
const GRID_GAP_PX = 8;
/** Seed row height (tile + gap) used only for the very first paint, before a
 * real row has been measured. Tile height scales with column width (the art
 * is aspect-ratio driven), so the live value is measured from a rendered row
 * and fed back as the estimate — see measuredRowHeight below. Without that
 * feedback the scrollbar mis-sizes badly: rows here are ~212px at a typical
 * panel width, so a fixed estimate left the total content height ~30% short
 * and the thumb jumped as rows measured in. */
const GRID_ROW_SEED_PX = 212;
const GRID_ROW_OVERSCAN = 3;
/** Assumed viewport height for the first render, before the scroll element
 * has been measured. See `initialRect` below. */
const GRID_INITIAL_VIEWPORT_PX = 600;
/** A screenful is ~12 tiles; anything beyond that came from a scroll jump. */
const PREVIEW_REQUEST_BATCH = 12;
const PREVIEW_REQUEST_DEBOUNCE_MS = 300;

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
  active,
  index,
  setSize,
  tabbable,
  onAudition,
  onAuditionEnd,
  onOpen,
  onFocusIndex,
  onToggleFavorite,
}: {
  entry: PresetCatalogEntry;
  preview: MilkdropPresetRenderPreview | null;
  variants: number;
  audition: boolean;
  active: boolean;
  index: number;
  setSize: number;
  tabbable: boolean;
  onAudition: (id: string) => void;
  onAuditionEnd: (id: string) => void;
  onOpen: (id: string) => void;
  onFocusIndex: (index: number) => void;
  onToggleFavorite: (entry: PresetCatalogEntry) => void;
}) {
  return (
    // List semantics, matching the list view, rather than listbox/option.
    // A tile carries two controls — open and save — and a listbox may only
    // contain options, so the star could never have lived inside one. The
    // listitem wrapper is also where the set-size/position pair belongs:
    // without it a screen reader reports only the handful of mounted tiles
    // as the entire result set.
    // biome-ignore lint/a11y/useSemanticElements: <li> would have to sit inside a <ul>, but virtualization puts an absolutely-positioned row wrapper between the list and its items — nesting a <div> row inside a <ul> is invalid HTML, so the roles carry the semantics instead
    <div
      className="stims-preset-grid__cell"
      role="listitem"
      aria-setsize={setSize}
      aria-posinset={index + 1}
    >
      <button
        type="button"
        className="stims-preset-grid__item"
        data-preset-id={entry.id}
        data-preset-index={index}
        data-active={active ? 'true' : 'false'}
        aria-current={active ? 'true' : undefined}
        tabIndex={tabbable ? 0 : -1}
        aria-label={
          variants > 0
            ? `${entry.title || entry.id} (+${variants} near-identical variant${variants === 1 ? '' : 's'})`
            : entry.title || entry.id
        }
        onPointerEnter={() => onAudition(entry.id)}
        onPointerLeave={() => onAuditionEnd(entry.id)}
        onFocus={() => {
          onFocusIndex(index);
          onAudition(entry.id);
        }}
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
      {/* A sibling of the tile, never a child: nesting an interactive
          control inside the tile button is invalid, and every save would
          also select the preset. Follows the roving index rather than being
          statically tabbable — otherwise each mounted tile adds a tab stop
          and Tab walks a wall of stars instead of leaving the grid. */}
      <button
        type="button"
        className="stims-preset-grid__fav"
        data-saved={String(Boolean(entry.isFavorite))}
        aria-label={
          entry.isFavorite
            ? `Remove ${entry.title} from saved`
            : `Save ${entry.title}`
        }
        title={entry.isFavorite ? 'Remove from saved' : 'Save preset'}
        aria-pressed={Boolean(entry.isFavorite)}
        tabIndex={tabbable ? 0 : -1}
        onClick={() => onToggleFavorite(entry)}
      >
        <span className="ctl-preset__fav-icon" aria-hidden="true" />
      </button>
    </div>
  );
});

/**
 * Grid browse view.
 *
 * Virtualized by row: only the tiles within the scroll viewport (plus
 * GRID_ROW_OVERSCAN rows either side) exist as DOM nodes, regardless of how
 * many presets match the filter. Previously the grid rendered the entire
 * result set and relied on `content-visibility: auto` to skip offscreen
 * layout/paint — but content-visibility does not skip node creation, style
 * resolution, or React reconciliation, so the default view built ~15.7k DOM
 * nodes and 2.6k <img> elements up front and re-reconciled all of them on
 * every search keystroke (measured: 60ms of blocking work per keypress).
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
  currentPresetId = null,
  onToggleFavorite,
  initialScrollTop = 0,
  onScrollTopChange,
  filterEpoch = 0,
}: {
  catalogEntries: PresetCatalogEntry[];
  presetPreviews: Record<string, MilkdropPresetRenderPreview>;
  requestPresetPreviews: (presetIds: string[]) => void | Promise<void>;
  routeState: { presetId: string | null; audioSource: AudioSource | null };
  setRouteState: (next: {
    presetId: string | null;
    audioSource: AudioSource | null;
  }) => void;
  currentPresetId?: string | null;
  onToggleFavorite: (entry: PresetCatalogEntry) => void;
  /** Offset this view was left at, restored on mount. */
  initialScrollTop?: number;
  onScrollTopChange?: (top: number) => void;
  /** Bumped by the panel when filters change, so the grid returns to the
   * top in step with the list instead of holding an offset into a result
   * set that no longer exists. */
  filterEpoch?: number;
}) {
  // The context request function changes identity on every session render;
  // keep the latest behind a ref so observers never re-subscribe over it.
  const requestPresetPreviewsRef = useRef(requestPresetPreviews);
  requestPresetPreviewsRef.current = requestPresetPreviews;
  const presetPreviewsRef = useRef(presetPreviews);
  presetPreviewsRef.current = presetPreviews;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
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

  // Column count has to track the container width the same way `auto-fill`
  // does, so a resized panel re-lays-out rows instead of leaving gaps.
  const [columnCount, setColumnCount] = useState(1);
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = (width: number) => {
      const minColumn =
        width < GRID_NARROW_PANEL_PX
          ? GRID_NARROW_MIN_COLUMN_PX
          : GRID_MIN_COLUMN_PX;
      const next = Math.max(
        1,
        Math.floor((width + GRID_GAP_PX) / (minColumn + GRID_GAP_PX)),
      );
      setColumnCount((current) => (current === next ? current : next));
    };
    measure(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Rows are uniform height at a given column width, so ONE measured row is
  // an exact size for all of them. That is why rows deliberately do not use
  // the virtualizer's dynamic `measureElement`: per-row measurement exists
  // for variable-height content, and here it actively conflicts — a
  // re-measure mid-scroll rewrites the offsets `scrollToIndex` just
  // targeted, which left Home/End setting scrollTop to a position the
  // virtualizer then never rendered (window stuck, focus stranded).
  // Measuring once and feeding it back as a uniform estimate keeps offsets
  // exact and the scrollbar honest for the ~99% of rows never mounted.
  const [measuredRowHeight, setMeasuredRowHeight] = useState(GRID_ROW_SEED_PX);
  const rowCount = Math.ceil(visibleEntries.length / columnCount);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => measuredRowHeight,
    overscan: GRID_ROW_OVERSCAN,
    // Without a starting rect the virtualizer has nothing to measure until
    // the scroll element exists, so the very first render emits zero tiles —
    // an empty grid on first paint, and nothing at all under a non-DOM
    // renderer (which is what silently emptied preset-grid.test.tsx when
    // this view was virtualized). A nominal viewport lets it produce a
    // plausible first window that real measurement then corrects.
    initialRect: { width: 0, height: GRID_INITIAL_VIEWPORT_PX },
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  // Restore where this view was left. Deferred past the commit for the same
  // reason the keyboard jumps are: a scroll event landing mid-render
  // collides with the virtualizer's flushSync and wedges it.
  // Mount only: later `initialScrollTop` values are this component
  // reporting its own scrolling back up, and re-applying them would fight
  // the user mid-scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only restore
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || initialScrollTop <= 0) return;
    const timer = window.setTimeout(() => {
      element.scrollTop = initialScrollTop;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Filters changed under us: the old offset points into a result set that
  // no longer exists. Skips mount so it cannot stomp the restore above.
  const filterEpochSettledRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: filterEpoch is a change signal, not a value read in the body
  useEffect(() => {
    if (!filterEpochSettledRef.current) {
      filterEpochSettledRef.current = true;
      return;
    }
    const element = scrollRef.current;
    if (element) element.scrollTop = 0;
  }, [filterEpoch]);

  // Deliberately a passive effect keyed on columnCount, with the actual
  // read deferred to a frame — NOT a layout effect running every render.
  // The virtualizer drives its own scroll updates through flushSync, and a
  // setState landing inside React's layout phase collides with that
  // ("flushSync was called from inside a lifecycle method"), which silently
  // wedges the virtualizer: scrollTop moves but the rendered window never
  // follows. Row height only changes when the column count does, so this is
  // both cheaper and safe.
  // biome-ignore lint/correctness/useExhaustiveDependencies: columnCount is not read in the body but is exactly what changes the row height — re-measuring on it is the point
  useEffect(() => {
    // setTimeout rather than rAF for the same reason as the scroll defer
    // below: rAF is starved while the document is hidden, which would leave
    // the row height stuck at the seed and mis-size the scrollbar there.
    // offsetHeight forces layout on demand, so waiting for paint buys
    // nothing anyway.
    const timer = window.setTimeout(() => {
      const row = gridRef.current?.querySelector<HTMLElement>(
        '.stims-preset-grid__row',
      );
      if (!row) return;
      const next = row.offsetHeight;
      // >1px guard: sub-pixel jitter must not re-trigger this forever.
      setMeasuredRowHeight((current) =>
        next > 0 && Math.abs(next - current) > 1 ? next : current,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [columnCount]);

  // A new estimateSize does NOT retroactively resize rows the virtualizer
  // has already measured — it caches them — so without this the layout
  // keeps spacing rows at the seed height while they render at their real
  // one, leaving a visible gap under every row (54px per row at 2 columns).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the estimate changes, not when the virtualizer instance churns
  useEffect(() => {
    rowVirtualizer.measure();
  }, [measuredRowHeight]);

  // Previews for the tiles actually on screen. This replaces a per-tile
  // IntersectionObserver that re-observed every tile in the grid on each
  // filter change (a querySelectorAll + up to 2.5k observe() calls per
  // keystroke) — the virtual window already *is* the visibility answer.
  const visibleIdsKey = virtualRows.length
    ? `${virtualRows[0].index}:${virtualRows[virtualRows.length - 1].index}:${columnCount}:${visibleEntries.length}`
    : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: visibleIdsKey collapses the window into one primitive; depending on virtualRows itself would re-fire this every scroll frame
  useEffect(() => {
    if (!virtualRows.length) return;
    const timer = window.setTimeout(() => {
      const first = virtualRows[0].index * columnCount;
      const last = Math.min(
        visibleEntries.length,
        (virtualRows[virtualRows.length - 1].index + 1) * columnCount,
      );
      const ids: string[] = [];
      for (let index = first; index < last; index += 1) {
        const entry = visibleEntries[index];
        if (!entry) continue;
        if (presetPreviewsRef.current[entry.id]?.status === 'ready') continue;
        ids.push(entry.id);
        if (ids.length >= PREVIEW_REQUEST_BATCH) break;
      }
      if (ids.length > 0) void requestPresetPreviewsRef.current(ids);
    }, PREVIEW_REQUEST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [visibleIdsKey]);

  // Roving tabindex, same rationale as the list view: only a fraction of the
  // tiles exist as DOM nodes, so useListKeyboardNav's querySelectorAll walk
  // cannot reach the rest. Index arithmetic + scrollToIndex works on the full
  // result set instead of just what happens to be mounted.
  const [rovingIndex, setRovingIndex] = useState(0);
  const pendingFocusIndexRef = useRef<number | null>(null);

  useEffect(() => {
    setRovingIndex(0);
  }, []);

  /** Focus the pending row if it is mounted; reports whether it landed. */
  const tryFocusPending = useCallback(() => {
    const pending = pendingFocusIndexRef.current;
    if (pending === null) return true;
    const tile = gridRef.current?.querySelector<HTMLElement>(
      `[data-preset-index="${pending}"]`,
    );
    if (!tile) return false;
    tile.focus();
    pendingFocusIndexRef.current = null;
    return true;
  }, []);

  // Fast path: a move within (or adjacent to) the rendered window mounts its
  // target in the very next commit, so focus lands without waiting.
  useLayoutEffect(() => {
    tryFocusPending();
  });

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (visibleEntries.length === 0) return;
      const active = document.activeElement;
      const activeTile =
        active instanceof HTMLElement
          ? active.closest<HTMLElement>('[data-preset-index]')
          : null;
      if (!activeTile) return;
      const currentIndex = Number(activeTile.dataset.presetIndex);

      let nextIndex = -1;
      switch (event.key) {
        case 'ArrowRight':
          nextIndex = currentIndex + 1;
          break;
        case 'ArrowLeft':
          nextIndex = currentIndex - 1;
          break;
        case 'ArrowDown':
          nextIndex = currentIndex + columnCount;
          break;
        case 'ArrowUp':
          nextIndex = currentIndex - columnCount;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = visibleEntries.length - 1;
          break;
        default:
          return;
      }
      if (nextIndex < 0 || nextIndex >= visibleEntries.length) return;
      event.preventDefault();
      event.stopPropagation();
      pendingFocusIndexRef.current = nextIndex;
      setRovingIndex(nextIndex);
      // Deferred a frame, deliberately. scrollToIndex moves scrollTop
      // synchronously, and the resulting scroll event lands while React is
      // still rendering the setRovingIndex update above — the virtualizer
      // handles scroll through flushSync, which React refuses mid-render
      // ("flushSync was called from inside a lifecycle method"). The scroll
      // position moved but the virtualizer's own offset never updated, so a
      // Home/End jump scrolled to the right place and then rendered the old
      // window there, stranding focus. Letting the commit finish first makes
      // the scroll event land in a clean frame.
      // setTimeout, not requestAnimationFrame: rAF does not fire while the
      // document is hidden (background tab, or an embedded/offscreen
      // preview), which would silently disable Home/End there.
      const targetRow = Math.floor(nextIndex / columnCount);
      window.setTimeout(() => {
        rowVirtualizer.scrollToIndex(targetRow, { align: 'auto' });
        // A long jump (Home/End) scrolls far enough that the target row is
        // not mounted in the commit that follows, and the layout effect
        // above only re-runs if something else re-renders — so without this
        // the roving index moves but focus is stranded on a now-unmounted
        // tile. Poll briefly for the row to appear, then give up rather
        // than hold a handle forever.
        let attempts = 0;
        const settle = () => {
          if (tryFocusPending() || attempts++ > 10) return;
          window.setTimeout(settle, 16);
        };
        settle();
      }, 0);
    },
    [visibleEntries.length, columnCount, rowVirtualizer, tryFocusPending],
  );

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
  const handleFocusIndex = useCallback((index: number) => {
    setRovingIndex(index);
  }, []);

  return (
    <div
      ref={scrollRef}
      className="stims-preset-grid-scroll"
      // Straight to the caller's module-scope memory, never to state: this
      // fires every scroll frame and a re-render per frame would undo the
      // virtualization it is riding on.
      onScroll={(event) => onScrollTopChange?.(event.currentTarget.scrollTop)}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: see the cell below — a <ul> may only contain <li>, and the virtualized row wrappers in between are <div>s, so this carries role="list" rather than emitting invalid markup */}
      <div
        ref={gridRef}
        className="stims-preset-grid"
        role="list"
        aria-label="Preset grid"
        onKeyDown={handleKeyDown}
        style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}
      >
        {virtualRows.map((virtualRow) => {
          const first = virtualRow.index * columnCount;
          const rowEntries = visibleEntries.slice(first, first + columnCount);
          return (
            <div
              key={virtualRow.key}
              className="stims-preset-grid__row"
              data-index={virtualRow.index}
              // Layout-only wrapper: without this the row divs sit between
              // the listbox and its options and break that relationship.
              role="presentation"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                gap: GRID_GAP_PX,
                paddingBottom: GRID_GAP_PX,
              }}
            >
              {rowEntries.map((entry, column) => {
                const index = first + column;
                return (
                  <GridTile
                    key={entry.id}
                    entry={entry}
                    preview={presetPreviews[entry.id] ?? null}
                    variants={variantCounts.get(entry.id) ?? 0}
                    audition={auditionId === entry.id}
                    active={entry.id === currentPresetId}
                    index={index}
                    setSize={visibleEntries.length}
                    tabbable={index === rovingIndex}
                    onAudition={handleAudition}
                    onAuditionEnd={handleAuditionEnd}
                    onOpen={handleOpen}
                    onFocusIndex={handleFocusIndex}
                    onToggleFavorite={onToggleFavorite}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
