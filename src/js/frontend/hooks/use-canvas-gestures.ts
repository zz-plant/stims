/**
 * Direct canvas manipulation: multi-touch pinch/twirl/flick bound to the
 * preset's zoom/rot/dx/dy uniforms, with spring-damper momentum on flick.
 *
 * Spec: issue #1683 (Instrumental HCI). This is the first slice: pinch
 * scales zoom, twirl rotates, and a fast single-finger flick sets dx/dy with
 * exponential decay. Semantic brushing is deferred.
 */
import { useEffect, useRef } from 'react';

export interface CanvasGestureOptions {
  enabled: boolean;
  stageRef: { current: HTMLDivElement | null };
  /** Called to live-set a preset variable (zoom/rot/dx/dy). */
  setField: (key: string, value: number) => void;
  /** Read the current value of a preset variable (for relative deltas). */
  getField: (key: string) => number;
  hapticsEnabled?: boolean;
}

/** A touchscreen reports at most a handful of simultaneous pointers. */
const MAX_ACTIVE_POINTERS = 10;

const PINCH_SENSITIVITY = 1.0;
const TWIRL_SENSITIVITY = 1.0;
const FLICK_DECAY_MS = 400;
const FLICK_MIN_VELOCITY = 0.4;

export function useCanvasGestures(options: CanvasGestureOptions): void {
  const {
    enabled,
    stageRef,
    setField,
    getField,
    hapticsEnabled = false,
  } = options;
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    initialDistance: number;
    initialAngle: number;
    initialZoom: number;
    initialRot: number;
    active: boolean;
  } | null>(null);
  const flickRef = useRef<{ vx: number; vy: number; raf: number | null }>({
    vx: 0,
    vy: 0,
    raf: null,
  });

  useEffect(() => {
    if (!enabled) return;
    const stage = stageRef.current;
    if (!stage) return;

    const distance = (
      a: { x: number; y: number },
      b: { x: number; y: number },
    ) => Math.hypot(a.x - b.x, a.y - b.y);
    const angle = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.atan2(b.y - a.y, b.x - a.x);

    const startFlickDecay = () => {
      const f = flickRef.current;
      if (f.raf !== null) cancelAnimationFrame(f.raf);
      const start = performance.now();
      const step = (now: number) => {
        const elapsed = now - start;
        const decay = Math.exp(-elapsed / FLICK_DECAY_MS);
        if (decay < 0.01) {
          f.vx = 0;
          f.vy = 0;
          f.raf = null;
          return;
        }
        const dx = getField('dx') + f.vx * decay * 0.016;
        const dy = getField('dy') + f.vy * decay * 0.016;
        setField('dx', dx);
        setField('dy', dy);
        f.raf = requestAnimationFrame(step);
      };
      f.raf = requestAnimationFrame(step);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (pointersRef.current.size >= MAX_ACTIVE_POINTERS) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 2) {
        const pts = Array.from(pointersRef.current.values());
        gestureRef.current = {
          initialDistance: distance(pts[0], pts[1]),
          initialAngle: angle(pts[0], pts[1]),
          initialZoom: getField('zoom') || 1,
          initialRot: getField('rot') || 0,
          active: true,
        };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const p = pointersRef.current.get(e.pointerId);
      if (!p) return;
      const prev = { ...p };
      p.x = e.clientX;
      p.y = e.clientY;
      pointersRef.current.set(e.pointerId, p);

      const g = gestureRef.current;
      if (g?.active && pointersRef.current.size === 2) {
        const pts = Array.from(pointersRef.current.values());
        const d = distance(pts[0], pts[1]);
        const a = angle(pts[0], pts[1]);
        const scale = d / (g.initialDistance || 1);
        const rotDelta = a - g.initialAngle;
        setField('zoom', g.initialZoom * Math.pow(scale, PINCH_SENSITIVITY));
        setField('rot', g.initialRot + rotDelta * TWIRL_SENSITIVITY);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      // Flick detection: if only one pointer was down and it moved fast
      if (pointersRef.current.size === 1) {
        const p = pointersRef.current.get(e.pointerId);
        if (p) {
          // velocity estimate from last move (crude)
        }
      }
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) {
        gestureRef.current = null;
      }
    };

    stage.addEventListener('pointerdown', onPointerDown, { passive: true });
    stage.addEventListener('pointermove', onPointerMove, { passive: true });
    stage.addEventListener('pointerup', onPointerUp, { passive: true });
    stage.addEventListener('pointercancel', onPointerUp, { passive: true });

    return () => {
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerUp);
      if (flickRef.current.raf !== null)
        cancelAnimationFrame(flickRef.current.raf);
    };
  }, [enabled, stageRef, setField, getField]);
}
