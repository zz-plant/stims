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
