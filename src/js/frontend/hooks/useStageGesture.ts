import { type RefObject, useEffect, useRef } from 'react';
import { pulseHaptic } from '../haptics.ts';

const WHEEL_DEBOUNCE_MS = 400;
/** Accumulated scroll distance that counts as "change the preset". */
const WHEEL_STEP_PX = 120;
/** A pause this long ends the current scroll gesture and drops its total. */
const WHEEL_IDLE_RESET_MS = 220;
const SWIPE_MIN_DISTANCE_PX = 64;
const SWIPE_MAX_OFF_AXIS_PX = 72;
const SWIPE_DEBOUNCE_MS = 450;
/** Past this, the finger was resting on the stage rather than swiping it. */
const SWIPE_MAX_DURATION_MS = 700;
const LONG_PRESS_MS = 650;
const LONG_PRESS_MOVE_TOLERANCE_PX = 14;
const TAP_MOVE_TOLERANCE_PX = 14;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_DISTANCE_PX = 24;

/** Normalize a wheel delta to pixels; Firefox reports lines, not pixels. */
function wheelDeltaPx(event: WheelEvent) {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) {
    return event.deltaY * (typeof window === 'undefined' ? 800 : innerHeight);
  }
  return event.deltaY;
}

/**
 * Runs `bind` against the stage element as soon as the ref holds one.
 *
 * The ref object itself never changes identity, so an effect that reads
 * `stageRef.current` on its first run and finds nothing has no way to hear
 * about the element arriving later — it would stay unbound (or, for the
 * wheel listener, silently fall back to a non-passive document listener,
 * which is exactly the compositor stall it is scoped to the stage to avoid).
 * Polling a frame at a time costs nothing in the normal case, where the
 * element is already there on the first call.
 */
function whenStageReady(
  stageRef: RefObject<HTMLElement | null> | undefined,
  bind: (stage: HTMLElement) => () => void,
): () => void {
  let unbind: (() => void) | null = null;
  let frame: number | null = null;
  let cancelled = false;

  const attempt = () => {
    frame = null;
    if (cancelled) return;
    const stage = stageRef?.current;
    if (!stage) {
      frame = requestAnimationFrame(attempt);
      return;
    }
    unbind = bind(stage);
  };

  attempt();

  return () => {
    cancelled = true;
    if (frame !== null) cancelAnimationFrame(frame);
    unbind?.();
  };
}

/**
 * Every gesture the stage answers to, in one place so the help surface can
 * list them. Only swipe and double-tap were ever mentioned anywhere in the
 * product: long-press, the vertical swipes and pinch/rotate were reachable
 * only by accident.
 */
export const STAGE_GESTURES: { gesture: string; label: string }[] = [
  { gesture: 'Swipe left', label: 'Next preset' },
  { gesture: 'Swipe right', label: 'Previous preset' },
  { gesture: 'Swipe up', label: 'Open browse' },
  { gesture: 'Swipe down', label: 'Close the open panel' },
  { gesture: 'Double-tap', label: 'Toggle fullscreen' },
  { gesture: 'Press and hold', label: 'Save the playing preset' },
  { gesture: 'Pinch / twist', label: 'Warp and rotate the visuals' },
  { gesture: 'Drag', label: 'Push the visuals around' },
  {
    gesture: 'Scroll',
    label: 'Nudge the visuals; keep going to change preset',
  },
];

function isInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest('.stims-shell__sheet') ||
        target.closest('[role="dialog"]') ||
        target.closest('.cm-editor') ||
        target.closest('button') ||
        target.closest('a') ||
        target.closest('input') ||
        target.closest('select') ||
        target.closest('textarea'),
    )
  );
}

export function useStageGesture({
  enabled,
  stageRef,
  handleShufflePreset,
  handlePreviousPreset,
  openBrowse,
  closePanel,
  toggleFavoritePreset,
  handleToggleFullscreen,
  setStatusMessage,
  hapticsEnabled = true,
  longPressMs = LONG_PRESS_MS,
}: {
  enabled: boolean;
  stageRef?: RefObject<HTMLElement | null>;
  handleShufflePreset: () => void;
  handlePreviousPreset: () => void;
  openBrowse?: () => void;
  closePanel?: () => void;
  toggleFavoritePreset?: () => void;
  handleToggleFullscreen?: () => void;
  setStatusMessage?: (message: string | null) => void;
  hapticsEnabled?: boolean;
  longPressMs?: number;
}) {
  const shuffleRef = useRef(handleShufflePreset);
  shuffleRef.current = handleShufflePreset;
  const prevRef = useRef(handlePreviousPreset);
  prevRef.current = handlePreviousPreset;
  const openBrowseRef = useRef(openBrowse);
  openBrowseRef.current = openBrowse;
  const closePanelRef = useRef(closePanel);
  closePanelRef.current = closePanel;
  const toggleFavoriteRef = useRef(toggleFavoritePreset);
  toggleFavoriteRef.current = toggleFavoritePreset;
  const toggleFullscreenRef = useRef(handleToggleFullscreen);
  toggleFullscreenRef.current = handleToggleFullscreen;
  const statusRef = useRef(setStatusMessage);
  statusRef.current = setStatusMessage;
  const lastWheelRef = useRef(0);
  const lastSwipeRef = useRef(0);
  const lastTapTimeRef = useRef(0);
  const lastTapPosRef = useRef({ x: 0, y: 0 });
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let accumulated = 0;
    let lastWheelAt = 0;

    const handleWheel = (event: WheelEvent) => {
      if (isInteractiveTarget(event.target)) return;

      const now = performance.now();
      const delta = wheelDeltaPx(event);
      if (delta === 0) return;

      // A fresh gesture starts the tally over: so does a direction change, so
      // scrolling back the other way doesn't have to first pay off the
      // distance already banked the first way.
      if (
        now - lastWheelAt > WHEEL_IDLE_RESET_MS ||
        Math.sign(delta) !== Math.sign(accumulated)
      ) {
        accumulated = 0;
      }
      lastWheelAt = now;
      accumulated += delta;

      // Under the threshold the notch belongs to the runtime, which reads it
      // off the canvas as the wheel_delta/wheel_accum preset signals. Only a
      // deliberate scroll is a preset change, and when it is, this consumes
      // the event so the same flick doesn't also nudge the visuals.
      if (Math.abs(accumulated) < WHEEL_STEP_PX) return;
      accumulated = 0;
      if (now - lastWheelRef.current < WHEEL_DEBOUNCE_MS) return;
      lastWheelRef.current = now;

      event.preventDefault();
      event.stopPropagation();
      if (delta > 0) {
        shuffleRef.current();
      } else {
        prevRef.current();
      }
    };

    // Capture phase, scoped to the stage: the canvas is a child of the stage
    // root and takes the same wheel events as continuous preset signals, so
    // deciding here — before the event reaches it — is what lets one notch do
    // exactly one thing. Scoping also matters for scroll performance: a
    // non-passive wheel listener on `document` opts every scrollable surface
    // (preset lists, editor, panels) out of the compositor's fast path.
    return whenStageReady(stageRef, (stage) => {
      stage.addEventListener('wheel', handleWheel as EventListener, {
        passive: false,
        capture: true,
      });
      return () =>
        stage.removeEventListener('wheel', handleWheel as EventListener, {
          capture: true,
        });
    });
  }, [enabled, stageRef]);

  useEffect(() => {
    if (!enabled) return;

    return whenStageReady(stageRef, (stage) => {
      const previousTouchAction = stage.style.touchAction;
      stage.style.touchAction = 'none';

      let startX = 0;
      let startY = 0;
      let startedAt = 0;
      let trackingPointerId: number | null = null;
      // Ids, not a count: pointerdown ignores pointers it will never track (a
      // mouse, or a touch that landed on a control) while pointerup fired for
      // every one of them, so the tally drifted below the number of fingers
      // actually down and dropped the multi-touch guard mid-pinch.
      const downPointerIds = new Set<number>();
      let multiTouchActive = false;
      let longPressFired = false;

      const clearLongPress = () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      };

      const releasePointer = (pointerId: number) => {
        downPointerIds.delete(pointerId);
        if (downPointerIds.size === 0) {
          multiTouchActive = false;
        }
      };

      const handlePointerDown = (event: PointerEvent) => {
        if (event.pointerType !== 'touch' || isInteractiveTarget(event.target))
          return;
        downPointerIds.add(event.pointerId);
        if (downPointerIds.size > 1) {
          // A second finger joined — this is the runtime's pinch/rotate
          // domain. Stop tracking the original pointer so none of the finger
          // lifts are read as a swipe, tap, or long-press.
          multiTouchActive = true;
          trackingPointerId = null;
          clearLongPress();
          return;
        }
        trackingPointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        startedAt = performance.now();
        longPressFired = false;
        clearLongPress();
        longPressTimerRef.current = setTimeout(() => {
          longPressFired = true;
          pulseHaptic(24, hapticsEnabled);
          toggleFavoriteRef.current?.();
        }, longPressMs);
      };

      const handlePointerMove = (event: PointerEvent) => {
        if (multiTouchActive || trackingPointerId !== event.pointerId) return;
        if (
          Math.hypot(event.clientX - startX, event.clientY - startY) >
          LONG_PRESS_MOVE_TOLERANCE_PX
        ) {
          clearLongPress();
        }
      };

      const handlePointerEnd = (event: PointerEvent) => {
        if (event.pointerType !== 'touch') return;
        // Never tracked (it started on a control, or before this listener was
        // bound) — leave the finger bookkeeping alone.
        if (!downPointerIds.has(event.pointerId)) return;
        const wasMultiTouch = multiTouchActive;
        releasePointer(event.pointerId);
        if (trackingPointerId !== event.pointerId) return;
        trackingPointerId = null;
        clearLongPress();
        if (wasMultiTouch || longPressFired) return;

        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        const now = performance.now();
        // A finger that rested on the stage and then moved is not a swipe,
        // however far it eventually travelled.
        const swiped = now - startedAt <= SWIPE_MAX_DURATION_MS;
        const swipeReady = now - lastSwipeRef.current >= SWIPE_DEBOUNCE_MS;

        if (
          swiped &&
          absX >= SWIPE_MIN_DISTANCE_PX &&
          absY <= SWIPE_MAX_OFF_AXIS_PX
        ) {
          if (!swipeReady) return;
          lastSwipeRef.current = now;
          if (dx > 0) {
            prevRef.current();
            pulseHaptic(12, hapticsEnabled);
            statusRef.current?.(
              'Previous preset. Swipe left for another surprise.',
            );
          } else {
            shuffleRef.current();
            pulseHaptic(12, hapticsEnabled);
            statusRef.current?.('Shuffled preset. Swipe right to go back.');
          }
          return;
        }

        if (
          swiped &&
          absY >= SWIPE_MIN_DISTANCE_PX &&
          absX <= SWIPE_MAX_OFF_AXIS_PX
        ) {
          if (!swipeReady) return;
          lastSwipeRef.current = now;
          if (dy < 0) {
            openBrowseRef.current?.();
            pulseHaptic([8, 20, 8], hapticsEnabled);
            statusRef.current?.(
              'Browse opened. Swipe down on the stage to close.',
            );
          } else {
            closePanelRef.current?.();
            pulseHaptic(10, hapticsEnabled);
            statusRef.current?.('Panel closed.');
          }
          return;
        }

        // Taps are deliberately outside the swipe debounce: a tap is not a
        // swipe, and gating it on the same timer made double-tap-to-fullscreen
        // silently do nothing for 450ms after any swipe.
        if (absX < TAP_MOVE_TOLERANCE_PX && absY < TAP_MOVE_TOLERANCE_PX) {
          const timeSinceLastTap = now - lastTapTimeRef.current;
          const tapDistance = Math.hypot(
            event.clientX - lastTapPosRef.current.x,
            event.clientY - lastTapPosRef.current.y,
          );
          if (
            timeSinceLastTap < DOUBLE_TAP_MS &&
            tapDistance < DOUBLE_TAP_DISTANCE_PX
          ) {
            lastTapTimeRef.current = 0;
            pulseHaptic([10, 20, 10], hapticsEnabled);
            toggleFullscreenRef.current?.();
            statusRef.current?.('Fullscreen toggled.');
            return;
          }
          lastTapTimeRef.current = now;
          lastTapPosRef.current = { x: event.clientX, y: event.clientY };
        }
      };

      const handlePointerCancel = (event: PointerEvent) => {
        if (event.pointerType !== 'touch') return;
        if (!downPointerIds.has(event.pointerId)) return;
        releasePointer(event.pointerId);
        if (trackingPointerId !== event.pointerId) return;
        trackingPointerId = null;
        clearLongPress();
      };

      stage.addEventListener('pointerdown', handlePointerDown, {
        passive: true,
      });
      stage.addEventListener('pointermove', handlePointerMove, {
        passive: true,
      });
      stage.addEventListener('pointerup', handlePointerEnd, { passive: true });
      stage.addEventListener('pointercancel', handlePointerCancel, {
        passive: true,
      });

      return () => {
        clearLongPress();
        stage.style.touchAction = previousTouchAction;
        stage.removeEventListener('pointerdown', handlePointerDown);
        stage.removeEventListener('pointermove', handlePointerMove);
        stage.removeEventListener('pointerup', handlePointerEnd);
        stage.removeEventListener('pointercancel', handlePointerCancel);
      };
    });
  }, [enabled, stageRef, hapticsEnabled, longPressMs]);
}
