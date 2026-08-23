/**
 * Ties the flash governor to a live canvas.
 *
 * The governor decides, the sampler observes, and this is the loop that
 * connects them plus the preference that gates the whole thing. Splitting it
 * this way keeps the WCAG decision testable without a DOM (see
 * tests/unit/flash-governor.test.ts) while the part that must touch a real
 * canvas stays small enough to read.
 *
 * It runs its OWN requestAnimationFrame loop rather than threading through
 * the milkdrop frame loop. Two reasons: the governor's subject is whatever is
 * actually on screen — which is what rAF is timed to — and it is renderer
 * agnostic, so a WebGL session, a WebGPU session, and any future backend get
 * the same protection without any of them knowing it exists.
 *
 * Sampling cost is 10us per frame at the recommended grid on a 1217x760
 * canvas, 0.06% of a 16.7ms budget (`bun run lab:flash-sampler-bench`). That
 * measurement is why this is a synchronous read rather than a fenced
 * asynchronous one: the async path is more code and more per-backend surface
 * for no measurable gain. Re-run the bench before assuming that still holds.
 *
 * Gated on the existing `reduceFlashing` accessibility preference, which
 * already means "do not hand me strobing content" for the catalog. Clamping
 * live output is the runtime half of the same promise, and the preference
 * defaults on under prefers-reduced-motion, so the people most likely to
 * need it do not have to go looking for a switch.
 */
import {
  getActiveAccessibilityPreference,
  subscribeToAccessibilityPreference,
} from '../accessibility-preferences.ts';
import {
  createFlashGovernor,
  type FlashGovernorDecision,
} from './flash-governor.ts';
import { createFlashSampler, type FlashSampler } from './flash-sampler.ts';

export type FlashSafetyOptions = {
  /** The presented canvas to observe. */
  canvas: HTMLCanvasElement;
  /** Applies the mitigation. Called only when the value changes. */
  applyLuminanceScale: (scale: number) => void;
  /** Overridable for tests; defaults to the accessibility preference. */
  isEnabled?: () => boolean;
  /** Overridable for tests. */
  scheduleFrame?: (callback: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  /**
   * Overridable for tests: the default reads real pixels, which needs a
   * canvas with a GPU behind it. Injecting a grid source lets the loop, the
   * preference gate, and the apply-on-change rule be tested for what they
   * are — plumbing — without standing up a renderer.
   */
  sampler?: FlashSampler;
};

export type FlashSafetyController = {
  start: () => void;
  stop: () => void;
  /**
   * Pre-clamp for a preset the catalog already measured above the WCAG
   * limit, so its first flashes are mitigated rather than merely counted.
   */
  prime: (hold: number) => void;
  /** Runs one observation. Exposed so tests need no animation frames. */
  tick: (nowMs: number) => FlashGovernorDecision | null;
  getState: () => FlashGovernorDecision;
  isRunning: () => boolean;
};

export function createFlashSafetyController(
  options: FlashSafetyOptions,
): FlashSafetyController {
  const {
    canvas,
    applyLuminanceScale,
    isEnabled = () => getActiveAccessibilityPreference().reduceFlashing,
    scheduleFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (handle) => cancelAnimationFrame(handle),
    sampler = createFlashSampler(),
  } = options;

  const governor = createFlashGovernor();
  let handle: number | null = null;
  let lastApplied = 1;

  function apply(scale: number) {
    // Only cross the DOM when the value actually moves; the common case is
    // an unengaged governor returning 1 sixty times a second.
    if (Math.abs(scale - lastApplied) < 0.001) return;
    lastApplied = scale;
    applyLuminanceScale(scale);
  }

  function tick(nowMs: number): FlashGovernorDecision | null {
    if (!isEnabled()) {
      // Releasing rather than freezing: a preference turned off mid-strobe
      // should not leave the picture dimmed.
      governor.reset();
      apply(1);
      return null;
    }
    const tiles = sampler.sample(canvas);
    if (!tiles) return null;

    // Close the loop. The mitigation is applied at COMPOSITE time (a CSS
    // filter on the stage), so reading the canvas back gives the unmitigated
    // pixels — the governor would never see its own effect, would keep
    // counting flashes it had already suppressed, and would escalate to the
    // ceiling and stay there. Scaling the sample by the mitigation currently
    // in force reconstructs what the viewer is actually looking at, which is
    // the same thing tests/unit/flash-governor.test.ts feeds it.
    if (lastApplied !== 1) {
      for (let i = 0; i < tiles.length; i += 1) {
        tiles[i] = (tiles[i] as number) * lastApplied;
      }
    }

    const decision = governor.sample(nowMs, tiles, sampler.cols, sampler.rows);
    apply(decision.luminanceScale);
    return decision;
  }

  function frame(time: number) {
    tick(time);
    if (handle !== null) {
      handle = scheduleFrame(frame);
    }
  }

  function start() {
    if (handle !== null) return;
    // Non-null before the first schedule so `frame` knows it is still live.
    handle = 0;
    handle = scheduleFrame(frame);
  }

  function stop() {
    if (handle !== null) {
      cancelFrame(handle);
      handle = null;
    }
    governor.reset();
    apply(1);
    sampler.dispose();
  }

  // A preference change should take effect now, not on the next strobe.
  const unsubscribe = subscribeToAccessibilityPreference(() => {
    if (!isEnabled()) {
      governor.reset();
      apply(1);
    }
  });

  return {
    start,
    prime: (initialHold: number) => {
      // Skipped while the preference is off, and NOT replayed if the user
      // turns it on later in the same preset: priming is a head start, not a
      // correctness requirement, and the reactive path reaches the same
      // clamp within about a second of the first flash either way.
      if (!isEnabled()) return;
      governor.prime(initialHold);
    },
    stop: () => {
      unsubscribe?.();
      stop();
    },
    tick,
    getState: () => governor.getState(),
    isRunning: () => handle !== null,
  };
}

/**
 * The DOM half: applies a luminance scale to a stage element as a CSS
 * brightness filter.
 *
 * Composited by the browser, so it costs nothing per frame and works
 * identically over a WebGL or a WebGPU canvas. CSS brightness multiplies
 * sRGB-encoded values rather than linear light, so the actual luminance
 * reduction is steeper than the requested factor — which does not matter:
 * the governor escalates until flashes stop being observed, so any monotone
 * reduction converges. It only has to move the right direction.
 */
export function createStageLuminanceApplier(stage: HTMLElement) {
  return (scale: number) => {
    stage.style.filter =
      scale >= 0.999 ? '' : `brightness(${scale.toFixed(3)})`;
  };
}
