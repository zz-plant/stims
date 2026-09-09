import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * @param holdVisible While true, nothing auto-hides: the deadline is dropped
 * and `visible` is pinned. For UI that is *open* rather than merely recently
 * touched — the stage overflow menu is rendered as a sibling of the bar, so
 * the bar's `:focus-within` reprieve never sees focus sitting in the menu,
 * and after three still seconds of reading it the bar went
 * `visibility: hidden` underneath. Escape then restored focus to a hidden
 * button, which is not focusable, so focus fell to `<body>` and the keyboard
 * user had to tab in from the top of the document.
 */
export function useAutoHideActivity(
  delayMs = 3000,
  initiallyVisible = true,
  holdVisible = false,
): {
  visible: boolean;
  signalActivity: () => void;
} {
  const [visible, setVisible] = useState(initiallyVisible);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(Date.now());
  // Read inside `signalActivity`, which must stay referentially stable for
  // the listeners built on it.
  const holdVisibleRef = useRef(holdVisible);
  holdVisibleRef.current = holdVisible;

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
    if (holdVisibleRef.current) return;
    // Keep the existing deadline during an activity burst. When it arrives,
    // the callback above moves it forward once from the most recent activity
    // instead of allocating a fresh timeout for every pointer event.
    if (timerRef.current === null) scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    if (holdVisible) {
      // Drop any deadline already in flight, then stay up until released.
      clearTimer();
      setVisible(true);
      return;
    }
    if (initiallyVisible) {
      // Releasing the hold starts a fresh countdown rather than resuming a
      // stale one, so the bar does not vanish the instant a menu closes.
      lastActivityRef.current = Date.now();
      scheduleHide();
    }
    return clearTimer;
  }, [holdVisible, initiallyVisible, clearTimer, scheduleHide]);

  return { visible, signalActivity };
}
