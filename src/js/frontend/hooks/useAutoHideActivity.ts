import { useCallback, useEffect, useRef, useState } from 'react';

export function useAutoHideActivity(
  delayMs = 3000,
  initiallyVisible = true,
): {
  visible: boolean;
  signalActivity: () => void;
} {
  const [visible, setVisible] = useState(initiallyVisible);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(Date.now());

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    const hideAfterInactivity = () => {
      const remainingMs = delayMs - (Date.now() - lastActivityRef.current);
      if (remainingMs > 0) {
        timerRef.current = setTimeout(hideAfterInactivity, remainingMs);
        return;
      }

      timerRef.current = null;
      setVisible(false);
    };
    timerRef.current = setTimeout(hideAfterInactivity, delayMs);
  }, [delayMs]);

  const signalActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setVisible(true);
    // Keep the existing deadline during an activity burst. When it arrives,
    // the callback above moves it forward once from the most recent activity
    // instead of allocating a fresh timeout for every pointer event.
    if (timerRef.current === null) scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    if (initiallyVisible) {
      lastActivityRef.current = Date.now();
      scheduleHide();
    }
    return clearTimer;
  }, [initiallyVisible, clearTimer, scheduleHide]);

  return { visible, signalActivity };
}
