/**
 * Frame-drawn notifications: the one moment the stage canvas can be read.
 *
 * Both render loops (the live loop in `animation-loop.ts` and the pre-audio
 * preview in `toy-runtime.ts`) call `notifyFrameDrawn` right after a frame is
 * drawn, in the same task as the draw. Anything that reads the canvas back
 * has to run there:
 *
 * - a WebGPU canvas holds its frame only until it is presented; read from a
 *   separate requestAnimationFrame callback it came back fully transparent,
 *   every time;
 * - a WebGL canvas without `preserveDrawingBuffer` (every mode but agent
 *   mode) may already be cleared; read that way it averaged a quarter of the
 *   brightness on screen.
 *
 * Measured 2026-10-06 against the flash sampler, which is what made the
 * Reduce flashing governor blind in production while every agent-mode check
 * of it passed.
 */

export type FrameDrawnListener = (nowMs: number) => void;

const listeners = new Set<FrameDrawnListener>();

/** Calls `listener` after every drawn frame until the returned function runs. */
export function subscribeToFrameDrawn(listener: FrameDrawnListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For the render loops: call once per frame, after the draw, same task. */
export function notifyFrameDrawn(nowMs: number) {
  for (const listener of listeners) {
    try {
      listener(nowMs);
    } catch (error) {
      // An observer must never cost the frame that already rendered.
      console.warn('[stims] Frame observer failed.', error);
    }
  }
}

/**
 * Runs `read` synchronously inside the next drawn frame's notification and
 * resolves with its result, or with null if no frame is drawn within
 * `timeoutMs` (a paused or stopped loop).
 */
export function readAfterNextFrameDrawn<T>(
  read: () => T,
  timeoutMs = 500,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
    const unsubscribe = subscribeToFrameDrawn(() => {
      clearTimeout(timer);
      unsubscribe();
      resolve(read());
    });
  });
}
