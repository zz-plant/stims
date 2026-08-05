import { type RefObject, useEffect, useRef } from 'react';
import { pulseHaptic } from '../haptics.ts';

const WHEEL_DEBOUNCE_MS = 400;
const SWIPE_MIN_DISTANCE_PX = 64;
const SWIPE_MAX_OFF_AXIS_PX = 72;
const SWIPE_DEBOUNCE_MS = 450;
const LONG_PRESS_MS = 650;
const LONG_PRESS_MOVE_TOLERANCE_PX = 14;

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

function _supportsTouchShortcutInput() {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia('(pointer: coarse)').matches ||
      navigator.maxTouchPoints > 0)
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
}: {
  enabled: boolean;
  stageRef?: RefObject<HTMLElement | null>;
  handleShufflePreset: () => void;
  handlePreviousPreset: () => void;
  openBrowse?: () => void;
  closePanel?: () => void;
  toggleFavoritePreset?: () => void;
  handleToggleFullscreen?: () => void;
  setStatusMessage?: (message: string) => void;
  hapticsEnabled?: boolean;
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

    const handleWheel = (event: WheelEvent) => {
      if (isInteractiveTarget(event.target)) return;

      const now = performance.now();
      if (now - lastWheelRef.current < WHEEL_DEBOUNCE_MS) return;
      lastWheelRef.current = now;

      if (event.deltaY > 0) {
        event.preventDefault();
        shuffleRef.current();
      } else if (event.deltaY < 0) {
        event.preventDefault();
        prevRef.current();
      }
    };

    document.addEventListener('wheel', handleWheel, { passive: false });
    return () => document.removeEventListener('wheel', handleWheel);
  }, [enabled]);

  useEffect(() => {
    const stage = stageRef?.current;
    if (!enabled || !stage) return;

    const previousTouchAction = stage.style.touchAction;
    stage.style.touchAction = 'none';

    let startX = 0;
    let startY = 0;
    let trackingPointerId: number | null = null;
    let activeTouchPointers = 0;
    let multiTouchActive = false;
    let longPressFired = false;

    const clearLongPress = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || isInteractiveTarget(event.target))
        return;
      activeTouchPointers += 1;
      if (activeTouchPointers > 1) {
        // A second finger joined — this is the runtime's pinch/rotate domain.
        // Stop tracking the original pointer so none of the finger lifts are
        // read as a swipe, tap, or long-press.
        multiTouchActive = true;
        trackingPointerId = null;
        clearLongPress();
        return;
      }
      trackingPointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      longPressFired = false;
      clearLongPress();
      longPressTimerRef.current = setTimeout(() => {
        longPressFired = true;
        pulseHaptic(24, hapticsEnabled);
        toggleFavoriteRef.current?.();
      }, LONG_PRESS_MS);
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
      activeTouchPointers = Math.max(0, activeTouchPointers - 1);
      if (trackingPointerId !== event.pointerId) {
        // A finger that wasn't the tracked one lifted (e.g. the first finger
        // of a pinch). Wait for the rest to lift before resetting.
        if (activeTouchPointers === 0) {
          multiTouchActive = false;
        }
        return;
      }
      trackingPointerId = null;
      clearLongPress();
      if (activeTouchPointers === 0) {
        multiTouchActive = false;
      }
      if (multiTouchActive || longPressFired) return;

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const now = performance.now();
      if (now - lastSwipeRef.current < SWIPE_DEBOUNCE_MS) return;

      if (absX >= SWIPE_MIN_DISTANCE_PX && absY <= SWIPE_MAX_OFF_AXIS_PX) {
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

      if (absY >= SWIPE_MIN_DISTANCE_PX && absX <= SWIPE_MAX_OFF_AXIS_PX) {
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

      if (absX < 14 && absY < 14) {
        const timeSinceLastTap = now - lastTapTimeRef.current;
        const tapDistance = Math.hypot(
          event.clientX - lastTapPosRef.current.x,
          event.clientY - lastTapPosRef.current.y,
        );
        if (timeSinceLastTap < 320 && tapDistance < 24) {
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
      activeTouchPointers = Math.max(0, activeTouchPointers - 1);
      if (trackingPointerId !== event.pointerId) return;
      trackingPointerId = null;
      clearLongPress();
      if (activeTouchPointers === 0) {
        multiTouchActive = false;
      }
    };

    stage.addEventListener('pointerdown', handlePointerDown, { passive: true });
    stage.addEventListener('pointermove', handlePointerMove, { passive: true });
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
  }, [enabled, stageRef, hapticsEnabled]);
}
