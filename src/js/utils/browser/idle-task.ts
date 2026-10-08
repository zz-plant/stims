/**
 * Schedule a non-critical callback during browser idle time, falling back to
 * a short setTimeout when requestIdleCallback is unavailable. The fallback
 * delay is explicit per call site so each caller keeps its own responsiveness
 * budget. Returns a cleanup that cancels the pending task.
 */
export function scheduleIdleTask(
  callback: () => void,
  options?: {
    idleTimeout?: number;
    fallbackDelay?: number;
  },
): () => void {
  const idleTimeout = options?.idleTimeout ?? 2500;
  const fallbackDelay = options?.fallbackDelay ?? 1200;
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(callback, { timeout: idleTimeout });
    return () => {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle);
    };
  }
  const handle = setTimeout(callback, fallbackDelay);
  return () => clearTimeout(handle);
}

/**
 * Run `callback` once the browser has painted and presented the current
 * frame. One animation frame is not enough: its callback runs before that
 * frame's paint, and a timeout queued from it can still land before the
 * frame reaches the screen. The second frame's callback starts after the
 * first was presented; the timeout then moves the work out of that frame's
 * rendering step. A hidden document gets no animation frames, so it falls
 * back to a bare timeout instead of waiting forever. Returns a cleanup that
 * cancels whichever step is pending.
 */
export function scheduleAfterPaint(callback: () => void): () => void {
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  if (
    typeof requestAnimationFrame !== 'function' ||
    (typeof document !== 'undefined' && document.visibilityState === 'hidden')
  ) {
    timer = setTimeout(callback, 0);
  } else {
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = 0;
        timer = setTimeout(callback, 0);
      });
    });
  }
  return () => {
    if (frame && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frame);
    }
    if (timer) clearTimeout(timer);
  };
}
