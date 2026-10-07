/**
 * Ties the flash governor to a live canvas.
 *
 * The governor decides, the sampler observes, and this is the loop that
 * connects them plus the preference that gates the whole thing. Splitting it
 * this way keeps the WCAG decision testable without a DOM (see
 * tests/unit/flash-governor.test.ts) while the part that must touch a real
 * canvas stays small enough to read.
 *
 * It samples on the render loops' frame-drawn notification
 * (`core/frame-drawn.ts`), in the same task as the draw, and stays renderer
 * agnostic: neither backend knows it exists. It used to run its own
 * requestAnimationFrame loop, which read the canvas outside that task — a
 * WebGPU canvas came back fully transparent and a WebGL one (no
 * preserveDrawingBuffer outside agent mode) at about a quarter of its
 * on-screen brightness, so the governor never saw a flash in production.
 *
 * The sample is a snapshot taken in the draw and read back off the main
 * thread (`flash-sampler.ts` has the measurements), so its grid can arrive
 * after the frame. It is judged as of the frame it was taken from: that
 * frame's time, and the mitigation that was on screen with it.
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
  type FrameDrawnListener,
  subscribeToFrameDrawn,
} from '../frame-drawn.ts';
import {
  createFlashGovernor,
  type FlashGovernorDecision,
} from './flash-governor.ts';
import { createFlashSampler, type FlashSampler } from './flash-sampler.ts';
import {
  setStageLuminanceChannel,
  stageLuminanceScale,
} from './stage-luminance.ts';

/**
 * Shortest gap between the frames the governor compares: three quarters of
 * a 60Hz frame.
 *
 * WCAG counts a flash as a pair of opposing luminance changes, and comparing
 * consecutive frames on a fast display counts changes no one can see. On a
 * 120Hz screen the default preset's frame-to-frame twinkle read as 82
 * flashes a second and clamped it to a tenth of its brightness; compared
 * 16.7ms apart it read 2.4, while a preset that really strobes (Abstract
 * Psychaos, 7.6) read the same either way. Measured 2026-10-06, headed
 * Chromium on a 120Hz display. A 60Hz cadence still resolves strobes up to
 * 30Hz, and on a fast display it also halves what sampling costs.
 *
 * Not a whole frame less a millisecond, which is what this was: frame
 * timestamps on a 60Hz display jitter by more than that, so a frame drawn
 * 15.5ms after the last sample was skipped and the next comparison spanned
 * 33ms, twice the motion the audit compares. On the first-run preset with
 * demo audio, 30 of 1,470 comparisons in 25s skipped a drawn frame (the
 * render loop itself dropped none), and the flash the governor counted was
 * across one of them. 12.5ms is clear of that jitter at 60Hz and still
 * skips every other frame at 120Hz (8.3ms).
 */
export const MIN_SAMPLE_INTERVAL_MS = (1000 / 60) * 0.75;

export type FlashSafetyOptions = {
  /** The presented canvas to observe. */
  canvas: HTMLCanvasElement;
  /** Applies the mitigation. Called only when the value changes. */
  applyLuminanceScale: (scale: number) => void;
  /**
   * What the viewer is actually seeing, as a scale on the rendered pixels.
   *
   * Defaults to this controller's own last applied value, which is right
   * only while the governor is the sole owner of the stage's brightness. It
   * is not: the visitor's comfort ceiling multiplies into the same CSS
   * filter, so a caller that composes channels must report the composed
   * scale here or the feedback correction in `tick` under-counts the
   * mitigation already in force (see `stage-luminance.ts`).
   */
  compositedScale?: () => number;
  /** Overridable for tests; defaults to the accessibility preference. */
  isEnabled?: () => boolean;
  /** Where drawn frames come from. Overridable for tests. */
  subscribeToFrames?: (listener: FrameDrawnListener) => () => void;
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
    subscribeToFrames = subscribeToFrameDrawn,
    sampler = createFlashSampler(),
    compositedScale,
  } = options;

  const governor = createFlashGovernor();
  let unsubscribeFrames: (() => void) | null = null;
  let lastApplied = 1;
  let lastSampleMs = Number.NEGATIVE_INFINITY;
  // Bumped whenever the governor is reset, so a grid still being read when
  // the preference goes off or the loop stops cannot dim the stage again.
  let generation = 0;

  function release() {
    generation += 1;
    governor.reset();
    apply(1);
  }

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
      release();
      return null;
    }
    if (nowMs - lastSampleMs < MIN_SAMPLE_INTERVAL_MS) return null;

    // Close the loop. The mitigation is applied at COMPOSITE time (a CSS
    // filter on the stage), so reading the canvas back gives the unmitigated
    // pixels — the governor would never see its own effect, would keep
    // counting flashes it had already suppressed, and would escalate to the
    // ceiling and stay there. Handing it the mitigation currently in force
    // lets it judge the content as the viewer is actually seeing it, which
    // is the same thing tests/unit/flash-governor.test.ts feeds it.
    //
    // The scale to correct by is everything on the filter, not just this
    // controller's contribution: with a visitor brightness ceiling of 0.5 the
    // viewer sees half of what `lastApplied` claims, and correcting by
    // `lastApplied` alone would leave the governor chasing brightness that is
    // already gone.
    //
    // Read now, with the frame, not when its grid arrives: by then the
    // mitigation may have moved, and this frame was seen through this one.
    const applied = compositedScale ? compositedScale() : lastApplied;
    const capturedIn = generation;
    let decision: FlashGovernorDecision | null = null;
    const captured = sampler.capture(canvas, (samples) => {
      if (!samples || capturedIn !== generation) return;
      decision = governor.sample(nowMs, samples, sampler.cols, sampler.rows, {
        density: sampler.density,
        viewScale: applied,
      });
      apply(decision.luminanceScale);
    });
    // A capture refused because the readback is backed up is not a sample,
    // so the next frame tries again rather than waiting a cadence.
    if (captured) lastSampleMs = nowMs;
    // Set only when the sampler answered before returning.
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

  // A preference change should take effect now, not on the next strobe.
  const unsubscribe = subscribeToAccessibilityPreference(() => {
    if (!isEnabled()) release();
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
    isRunning: () => unsubscribeFrames !== null,
  };
}

/**
 * The DOM half: applies a luminance scale to a stage element as a CSS
 * brightness filter.
 *
 * Writes through `stage-luminance.ts` rather than touching `style.filter`
 * directly: the visitor's comfort ceiling shares that one property, and this
 * loop would overwrite it every frame.
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
    setStageLuminanceChannel(stage, 'governor', scale);
  };
}

/**
 * The composed scale on that same stage, for the controller's feedback
 * correction. Paired with the applier above so a caller cannot wire one
 * without the other and leave the governor reading its own channel.
 */
export function createStageCompositedScale(stage: HTMLElement) {
  return () => stageLuminanceScale(stage);
}
