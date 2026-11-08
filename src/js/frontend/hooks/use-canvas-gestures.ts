/**
 * Direct canvas manipulation: two-finger pinch and twirl bound to the
 * preset's zoom/rot fields.
 *
 * Spec: issue #1683 (Instrumental HCI). This is the first slice. Single-finger
 * swipes are already the preset-navigation gesture, so this hook deliberately
 * only claims two-finger gestures; a one-finger flick is left to a later
 * explicit manipulate mode.
 */
import { useEffect, useRef } from 'react';

export interface CanvasGestureOptions {
  enabled: boolean;
  stageRef: { current: HTMLDivElement | null };
  /** Called to live-set a preset variable (zoom/rot). */
  setField: (key: string, value: number) => void;
  /**
   * Read the per-frame base value a `setField` write lands in. Must be the
   * base, not the evaluated state: an equation that recomputes the field
   * would otherwise apply a second time on top of the gesture.
   */
  getFieldBase: (key: string) => number | undefined;
}

/** A touchscreen reports at most a handful of simultaneous pointers. */
const MAX_ACTIVE_POINTERS = 10;

const PINCH_SENSITIVITY = 1.0;
const TWIRL_SENSITIVITY = 1.0;

export function useCanvasGestures(options: CanvasGestureOptions): void {
  const { enabled, stageRef, setField, getFieldBase } = options;
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    initialDistance: number;
    initialAngle: number;
    initialZoom: number;
    initialRot: number;
  } | null>(null);

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

    // Re-anchor on every change of the pointer pair. A third finger joining
    // or one of the original pair lifting must restart the baseline, or the
    // next move computes a transform for a different pair against stale
    // distance, angle, and field values.
    const anchor = () => {
      if (pointersRef.current.size !== 2) {
        gestureRef.current = null;
        return;
      }
      const pts = Array.from(pointersRef.current.values());
      gestureRef.current = {
        initialDistance: distance(pts[0], pts[1]),
        initialAngle: angle(pts[0], pts[1]),
        initialZoom: getFieldBase('zoom') ?? 1,
        initialRot: getFieldBase('rot') ?? 0,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (pointersRef.current.size >= MAX_ACTIVE_POINTERS) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      anchor();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const p = pointersRef.current.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      pointersRef.current.set(e.pointerId, p);

      const g = gestureRef.current;
      if (g && pointersRef.current.size === 2) {
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
      pointersRef.current.delete(e.pointerId);
      anchor();
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
      pointersRef.current.clear();
      gestureRef.current = null;
    };
  }, [enabled, stageRef, setField, getFieldBase]);
}
