import { useEffect, useRef } from 'react';

const WHEEL_DEBOUNCE_MS = 400;

export function useStageGesture({
  enabled,
  handleShufflePreset,
  handlePreviousPreset,
}: {
  enabled: boolean;
  handleShufflePreset: () => void;
  handlePreviousPreset: () => void;
}) {
  const shuffleRef = useRef(handleShufflePreset);
  shuffleRef.current = handleShufflePreset;
  const prevRef = useRef(handlePreviousPreset);
  prevRef.current = handlePreviousPreset;
  const lastWheelRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const handleWheel = (event: WheelEvent) => {
      if (
        event.target instanceof HTMLElement &&
        (event.target.closest('.stims-shell__sheet') ||
          event.target.closest('[role="dialog"]') ||
          event.target.closest('.cm-editor') ||
          event.target.closest('input') ||
          event.target.closest('textarea'))
      ) {
        return;
      }

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
}
