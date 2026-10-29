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
 * The gestures that count as a visitor asking the page to do something.
 * `pointermove` is deliberately absent: a cursor already over the window can
 * emit one on load, which would defeat the deferral for everyone.
 */
const FIRST_INTENT_EVENTS = [
  'pointerdown',
  'keydown',
  'scroll',
  'wheel',
  'touchstart',
] as const;

/**
 * Run a decorative effect on the first sign of visitor intent, or after a
 * fixed grace period if no one interacts.
 *
 * The decorative attract render is the heaviest thing a bare landing boots:
 * the engine chunks, a GPU context, a preset compile and the first frames.
 * Deferring it to `requestIdleCallback` helped, but an idle callback fires as
 * soon as the browser is briefly idle — often well inside the load window on
 * a fast machine — so the work still lands on the critical path. A plain
 * grace period keeps the static field until the visitor shows intent (a
 * click, key, scroll, wheel or touch) or the period ends. Deep links and
 * audio arrivals do not use it; they are real intent already.
 */
export function scheduleOnFirstIntent(
  callback: () => void,
  options?: {
    /** Grace period in ms when nobody interacts. */
    fallbackDelay?: number;
    events?: readonly string[];
  },
): () => void {
  if (typeof window === 'undefined') {
    return scheduleIdleTask(callback, {
      idleTimeout: options?.fallbackDelay,
      fallbackDelay: options?.fallbackDelay,
    });
  }
  const events = options?.events ?? FIRST_INTENT_EVENTS;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    for (const event of events) {
      window.removeEventListener(event, run, true);
    }
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const run = () => {
    if (done) return;
    done = true;
    cleanup();
    callback();
  };
  for (const event of events) {
    window.addEventListener(event, run, {
      capture: true,
      once: true,
      passive: true,
    });
  }
  timer = setTimeout(run, options?.fallbackDelay ?? 3000);
  return () => {
    done = true;
    cleanup();
  };
}

/**
 * Schedule a non-critical effect to run during browser idle time, where the
 * effect returns its own disposal. Cancelling before the task runs, or after
 * it ran, both invoke that disposal exactly once — the shape React effect
 * cleanup needs, so a scheduled effect can never leak its resource by being
 * cancelled late.
 *
 * Falls back to a short setTimeout when requestIdleCallback is unavailable.
 */
export function deferToIdle(
  fn: () => undefined | (() => void),
  options?: { idleTimeout?: number; fallbackDelay?: number },
): () => void {
  let cancelled = false;
  let dispose: (() => void) | undefined;
  const run = () => {
    if (cancelled) return;
    dispose = fn();
  };
  const cancel = scheduleIdleTask(run, {
    idleTimeout: options?.idleTimeout ?? 2000,
    fallbackDelay: options?.fallbackDelay ?? 80,
  });
  return () => {
    cancelled = true;
    cancel();
    dispose?.();
  };
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
