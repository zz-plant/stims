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

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const signalActivity = useCallback(() => {
    setVisible(true);
    clearTimer();
    timerRef.current = setTimeout(() => setVisible(false), delayMs);
  }, [delayMs, clearTimer]);

  useEffect(() => {
    if (initiallyVisible) {
      timerRef.current = setTimeout(() => setVisible(false), delayMs);
    }
    return clearTimer;
  }, [delayMs, initiallyVisible, clearTimer]);

  return { visible, signalActivity };
}
