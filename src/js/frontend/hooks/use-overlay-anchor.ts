import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/**
 * Drag-to-snap positioning for stage overlays. The overlay never gets free
 * pixel coordinates: it lives at one of a small set of anchors (CSS rules
 * keyed off `data-anchor`), the hook only decides *which* anchor. Dragging
 * follows the pointer via transform; on release the overlay snaps to the
 * nearest anchor along the axis, animated FLIP-style, and the choice is
 * persisted so it survives reloads, resizes, and orientation changes.
 */

const DRAG_THRESHOLD_PX = 6;
const SNAP_MS = 180;

const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [tabindex]';

function readStoredAnchor<A extends string>(
  storageKey: string,
  anchors: readonly A[],
): A | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey);
    return raw !== null && (anchors as readonly string[]).includes(raw)
      ? (raw as A)
      : null;
  } catch {
    return null;
  }
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function useOverlayAnchor<A extends string>({
  storageKey,
  anchors,
  defaultAnchor,
  axis,
}: {
  storageKey: string;
  /** Ordered along the axis: e.g. ['left', 'right'] or ['top', 'bottom']. */
  anchors: readonly A[];
  defaultAnchor: A;
  axis: 'horizontal' | 'vertical';
}) {
  const [anchor, setAnchorState] = useState<A>(
    () => readStoredAnchor(storageKey, anchors) ?? defaultAnchor,
  );
  const targetRef = useRef<HTMLElement | null>(null);
  const attachTarget = useCallback((el: HTMLElement | null) => {
    targetRef.current = el;
  }, []);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  // Rect captured at drag release (plus the anchor it was released toward),
  // consumed by the FLIP effect below.
  const flipFromRef = useRef<{ rect: DOMRect; toAnchor: A } | null>(null);

  const setAnchor = useCallback(
    (next: A) => {
      setAnchorState(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // private mode / quota — the anchor still applies for this session
      }
    },
    [storageKey],
  );

  // FLIP: after React re-renders the overlay at its new anchor, translate it
  // back to where the drag left it and let the transform ease out to zero.
  useLayoutEffect(() => {
    const el = targetRef.current;
    const flip = flipFromRef.current;
    flipFromRef.current = null;
    if (!el || !flip || flip.toAnchor !== anchor || prefersReducedMotion()) {
      return;
    }
    const to = el.getBoundingClientRect();
    const dx = flip.rect.left - to.left;
    const dy = flip.rect.top - to.top;
    if (dx === 0 && dy === 0) return;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    // Force the starting transform to land before easing it away.
    el.getBoundingClientRect();
    el.style.transition = `transform ${SNAP_MS}ms ease`;
    el.style.transform = '';
    const timer = window.setTimeout(() => {
      el.style.transition = '';
    }, SNAP_MS + 50);
    return () => window.clearTimeout(timer);
  }, [anchor]);

  const nearestAnchor = useCallback(
    (rect: DOMRect): A => {
      const fraction =
        axis === 'horizontal'
          ? (rect.left + rect.width / 2) / window.innerWidth
          : (rect.top + rect.height / 2) / window.innerHeight;
      const index = Math.round(
        Math.min(1, Math.max(0, fraction)) * (anchors.length - 1),
      );
      return anchors[index] ?? defaultAnchor;
    },
    [anchors, axis, defaultAnchor],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const drag = dragRef.current;
      const el = targetRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      if (!el || !drag.active) return;
      el.removeAttribute('data-dragging');

      const rect = el.getBoundingClientRect();
      const next = cancelled ? anchor : nearestAnchor(rect);
      el.style.transform = '';
      if (next !== anchor) {
        flipFromRef.current = { rect, toAnchor: next };
        setAnchor(next);
      } else if (!prefersReducedMotion()) {
        // Same anchor: ease back home from wherever the drag ended.
        const to = el.getBoundingClientRect();
        el.style.transition = 'none';
        el.style.transform = `translate(${rect.left - to.left}px, ${rect.top - to.top}px)`;
        el.getBoundingClientRect();
        el.style.transition = `transform ${SNAP_MS}ms ease`;
        el.style.transform = '';
        window.setTimeout(() => {
          el.style.transition = '';
        }, SNAP_MS + 50);
      }
    },
    [anchor, nearestAnchor, setAnchor],
  );

  const surfaceProps = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (!e.isPrimary) return;
      if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // synthetic or already-released pointer; move events still arrive
      }
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      const el = targetRef.current;
      if (!drag || drag.pointerId !== e.pointerId || !el) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        drag.active = true;
        el.setAttribute('data-dragging', 'true');
        el.style.transition = 'none';
      }
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => endDrag(e, false),
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => endDrag(e, true),
  } as const;

  // Belt-and-braces: a mid-drag unmount must not leave a stray transform.
  useEffect(
    () => () => {
      dragRef.current = null;
    },
    [],
  );

  const targetProps = {
    ref: attachTarget,
    'data-anchor': anchor,
  } as const;

  return { anchor, setAnchor, targetProps, surfaceProps } as const;
}
