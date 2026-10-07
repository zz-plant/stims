/**
 * Ties the flash governor to a live canvas.
 *
 * The governor decides, the sampler observes, and this is the loop that
 * connects them. Splitting it this way keeps the WCAG decision testable
 * without a DOM (governor.test.ts) while the part that must touch a real
 * canvas stays small enough to read.
 *
 * Where the sample is taken matters more than anything else in this file.
 * A WebGPU canvas holds its frame only until it is presented: read from a
 * separate requestAnimationFrame callback it comes back fully transparent.
 * A WebGL canvas without `preserveDrawingBuffer` may already be cleared, and
 * read that way it averaged a quarter of the brightness on screen. So the
 * sample has to be taken in the same task as the draw. Call `tick(now)` at
 * the end of your render function, or pass `subscribeToFrames` so the
 * controller can hook your render loop's own frame notification. The
 * default requestAnimationFrame fallback is only correct for a canvas that
 * preserves its drawing buffer, and it says so.
 *
 * The sample may arrive after the frame (the sampler reads back off the main
 * thread). It is judged as of the frame it was taken from: that frame's
 * time, and the mitigation that was on screen with it.
 */
import {
  createFlashGovernor,
  type FlashGovernorDecision,
  type FlashGovernorOptions,
} from './governor.ts';
import { createFlashSampler, type FlashSampler } from './sampler.ts';

/**
 * Shortest gap between the frames the governor compares: one 60 Hz frame,
 * less a millisecond of timer jitter.
 *
 * WCAG counts a flash as a pair of opposing luminance changes, and comparing
 * consecutive frames on a fast display counts changes no one can see. On a
 * 120 Hz screen, frame-to-frame twinkle in calm content read as 82 flashes a
 * second and clamped it to a tenth of its brightness; compared 16.7 ms apart
 * it read 2.4, while content that really strobed read the same either way.
 * A 60 Hz cadence still resolves strobes up to 30 Hz, and on a fast display
 * it also halves what sampling costs.
 */
export const MIN_SAMPLE_INTERVAL_MS = 1000 / 60 - 1;

export type FrameListener = (nowMs: number) => void;

export type FlashControllerOptions = {
  /** The presented canvas to observe. */
  canvas: HTMLCanvasElement;
  /**
   * Applies the mitigation: a luminance scale, 1 for untouched. Called only
   * when the value changes. See `createBrightnessFilterApplier`.
   */
  applyLuminanceScale: (scale: number) => void;
  /**
   * What the viewer is actually seeing, as a scale on the rendered pixels.
   *
   * Defaults to this controller's own last applied value, which is right
   * only while the governor is the sole owner of the canvas's brightness.
   * If something else (a user brightness setting, say) multiplies into the
   * same filter, report the composed scale here, or the feedback correction
   * under-counts the mitigation already in force and clamps harder than the
   * content warrants.
   */
  compositedScale?: () => number;
  /** Gate. When it returns false the controller releases and does nothing. */
  isEnabled?: () => boolean;
  /**
   * Where drawn frames come from. Should call the listener in the same task
   * as the draw. Defaults to a requestAnimationFrame loop, which is only
   * correct for a canvas that preserves its drawing buffer.
   */
  subscribeToFrames?: (listener: FrameListener) => () => void;
  /** Reads luminance grids from the canvas. Defaults to `createFlashSampler()`. */
  sampler?: FlashSampler;
  /** Tuning for the underlying governor. */
  governor?: FlashGovernorOptions;
  /** Minimum spacing between compared samples. */
  minSampleIntervalMs?: number;
};

export type FlashController = {
  /** Subscribe to frames and start sampling. */
  start: () => void;
  /** Unsubscribe, release the mitigation and dispose the sampler. */
  stop: () => void;
  /**
   * Pre-clamp for content already known to flash, so its first flashes are
   * mitigated rather than merely counted. See `primingHoldForMeasurement`.
   */
  prime: (hold: number) => void;
  /** Release the mitigation and forget history, without stopping. */
  release: () => void;
  /**
   * Runs one observation for a frame drawn at `nowMs`. Call it from your
   * render loop if you did not pass `subscribeToFrames`. Returns the decision
   * when the sampler answered synchronously, else null.
   */
  tick: (nowMs: number) => FlashGovernorDecision | null;
  getState: () => FlashGovernorDecision;
  isRunning: () => boolean;
};

function subscribeToAnimationFrames(listener: FrameListener): () => void {
  let handle = 0;
  let stopped = false;
  const loop = (now: number) => {
    if (stopped) return;
    listener(now);
    handle = requestAnimationFrame(loop);
  };
  handle = requestAnimationFrame(loop);
  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
  };
}

export function createFlashController(
  options: FlashControllerOptions,
): FlashController {
  const {
    canvas,
    applyLuminanceScale,
    isEnabled = () => true,
    subscribeToFrames = subscribeToAnimationFrames,
    sampler = createFlashSampler(),
    compositedScale,
    minSampleIntervalMs = MIN_SAMPLE_INTERVAL_MS,
  } = options;

  const governor = createFlashGovernor(options.governor);
  let unsubscribeFrames: (() => void) | null = null;
  let lastApplied = 1;
  let lastSampleMs = Number.NEGATIVE_INFINITY;
  // Bumped whenever the governor is reset, so a grid still being read when
  // the gate closes or the loop stops cannot dim the canvas again.
  let generation = 0;

  function apply(scale: number) {
    // Only cross the DOM when the value actually moves; the common case is
    // an unengaged governor returning 1 sixty times a second.
    if (Math.abs(scale - lastApplied) < 0.001) return;
    lastApplied = scale;
    applyLuminanceScale(scale);
  }

  function release() {
    generation += 1;
    governor.reset();
    apply(1);
  }

  function tick(nowMs: number): FlashGovernorDecision | null {
    if (!isEnabled()) {
      // Releasing rather than freezing: a gate closed mid-strobe should not
      // leave the picture dimmed.
      release();
      return null;
    }
    if (nowMs - lastSampleMs < minSampleIntervalMs) return null;

    // Close the loop. The mitigation is applied at composite time, so
    // reading the canvas back gives the unmitigated pixels: the governor
    // would never see its own effect, would keep counting flashes it had
    // already suppressed, and would escalate to the ceiling and stay there.
    // Scaling the sample by the mitigation in force reconstructs what the
    // viewer is actually looking at.
    //
    // Read the scale now, with the frame, not when its grid arrives: by then
    // the mitigation may have moved, and this frame was seen through this one.
    const applied = compositedScale ? compositedScale() : lastApplied;
    const capturedIn = generation;
    let decision: FlashGovernorDecision | null = null;
    const captured = sampler.capture(canvas, (tiles) => {
      if (!tiles || capturedIn !== generation) return;
      if (applied !== 1) {
        for (let i = 0; i < tiles.length; i += 1) {
          tiles[i] = (tiles[i] as number) * applied;
        }
      }
      decision = governor.sample(nowMs, tiles, sampler.cols, sampler.rows);
      apply(decision.luminanceScale);
    });
    // A capture refused because the last one is still being read is not a
    // sample, so the next frame tries again rather than waiting a cadence.
    if (captured) lastSampleMs = nowMs;
    return decision;
  }

  function start() {
    if (unsubscribeFrames !== null) return;
    unsubscribeFrames = subscribeToFrames((time) => {
      tick(time);
    });
  }

  function stop() {
    if (unsubscribeFrames !== null) {
      unsubscribeFrames();
      unsubscribeFrames = null;
    }
    release();
    sampler.dispose();
  }

  return {
    start,
    stop,
    prime: (initialHold: number) => {
      // Skipped while the gate is closed: priming is a head start, not a
      // correctness requirement, and the reactive path reaches the same
      // clamp within about a second of the first flash either way.
      if (!isEnabled()) return;
      governor.prime(initialHold);
    },
    release,
    tick,
    getState: () => governor.getState(),
    isRunning: () => unsubscribeFrames !== null,
  };
}

/**
 * The DOM half: applies a luminance scale to an element as a CSS brightness
 * filter. Composited by the browser, so it costs nothing per frame and works
 * identically over a WebGL or a WebGPU canvas.
 *
 * CSS brightness multiplies sRGB-encoded values rather than linear light, so
 * the actual luminance reduction is steeper than the requested factor. That
 * does not matter: the governor escalates until flashes stop being observed,
 * so any monotone reduction converges. It only has to move the right way.
 *
 * Clearing rather than writing `brightness(1)` keeps the element off the
 * filter path in the common case where nothing is engaged; a filter, even an
 * identity one, forces a compositing layer the renderer may not need.
 */
export function createBrightnessFilterApplier(element: HTMLElement) {
  return (scale: number) => {
    const clamped = Number.isFinite(scale)
      ? Math.min(1, Math.max(0, scale))
      : 1;
    element.style.filter =
      clamped >= 0.999 ? '' : `brightness(${clamped.toFixed(3)})`;
  };
}
