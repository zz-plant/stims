/**
 * Runtime photosensitive-flash governor.
 *
 * `scripts/flash-analysis.ts` audits presets offline: it can tell you that
 * fifty presets are fine. It cannot say anything about the preset an LLM
 * generated five minutes ago, or a preset a user just imported, or a
 * parameter the performer is dragging live — which are exactly the cases
 * that matter. This module closes that gap by applying the SAME WCAG 2.3.1
 * rule to the frames actually being shown, while they are being shown.
 *
 * Feed it a coarse luminance grid per frame; it returns how hard to hold the
 * previous frame. Temporal integration is what a strobe cannot survive, so
 * holding is both the mitigation and (once the renderer applies it) the
 * reason the next sample stops qualifying as a flash.
 *
 * It is deliberately a pure state machine over samples rather than anything
 * that touches a canvas: the sampling strategy differs per backend and must
 * never stall the pipeline, but the DECISION should be identical everywhere
 * and testable without a GPU.
 *
 * Semantics inherited from flash-thresholds.ts, matching the offline audit:
 *   - a tile transition qualifies when |dL| >= 0.1 and the darker end < 0.8
 *   - a FRAME transition qualifies when qualifying tiles cover >= 25% of any
 *     10-degree visual field (a sliding third-by-third window, not the whole
 *     screen)
 *   - a *flash* is a PAIR of opposing transitions, so a monotonic fade is
 *     not a flash
 *   - more than 3 flashes in any 1-second window fails
 *
 * This is a screen-content heuristic, not a medical device. It reduces
 * measured flash rate; it does not certify anything as safe.
 */
import {
  FLASH_AREA_FRACTION,
  FLASH_LUMINANCE_DELTA,
  FLASHES_PER_SECOND_LIMIT,
  isFlashTransition,
  peakWindowFraction,
} from '../flash-thresholds.ts';

export type FlashGovernorOptions = {
  /** Flashes per window before the governor is fully engaged. */
  limit?: number;
  /** Width of the sliding window, in milliseconds. */
  windowMs?: number;
  /**
   * Flashes at which intervention STARTS, below `limit`. Acting only on the
   * fourth flash would mean the failing sequence has already been shown;
   * the point is to intervene while still compliant.
   */
  engageAt?: number;
  /**
   * Hold applied on first engaging, 0..1. Deliberately gentle.
   *
   * This used to be 0.85, which made it a FLOOR rather than a starting
   * point: any content that qualified at all was clamped to ~10% brightness,
   * so a mild 0.15-delta flicker was punished exactly as hard as a full
   * black-to-white strobe. Starting low and letting `escalatePerFlash` find
   * the level makes the response proportional to how dangerous the content
   * actually is.
   */
  engageHold?: number;
  /**
   * Minimum extra hold added per flash, as a floor under the solved step.
   *
   * The governor does not ramp blindly. It measures the luminance swing it
   * just observed, so on a flash it can SOLVE for the scale that puts that
   * swing under the threshold and jump straight there — one step, whatever
   * the contrast. Blind ramping was measurably worse: escalating 0.08 per
   * flash from a gentle start let a black-to-white strobe land nine flashes
   * before the clamp caught up, when the limit is three.
   *
   * The floor still matters for the case where the solved step is tiny but
   * flashes keep landing, so progress is always monotonic.
   */
  escalatePerFlash?: number;
  /**
   * Fraction of the flash threshold the solved step aims for, below 1 so the
   * clamp lands inside the limit rather than exactly on it.
   */
  safetyMargin?: number;
  /** Hard ceiling on hold, so the picture never goes fully static. */
  holdCeiling?: number;
  /**
   * Per-frame decay applied to `hold` once the window has been clear for
   * `releaseDelayMs`, so the picture eases back instead of popping.
   *
   * Slow on purpose. At 0.06/frame the governor released a full clamp in
   * about a quarter second, which let the strobe restart, re-trigger, and
   * settle into a limit cycle — measured at 8 flashes/s while pinned at the
   * ceiling, i.e. the governor was manufacturing the very thing it exists to
   * prevent. Releasing over seconds rather than frames is what makes the
   * suppression actually hold.
   */
  releasePerFrame?: number;
  /**
   * How long the flash window must stay CLEAR before releasing begins.
   *
   * Without it, release starts the instant the window empties — which is
   * guaranteed to happen while the clamp is working, so the clamp
   * immediately undoes itself.
   */
  releaseDelayMs?: number;
};

export type FlashGovernorDecision = {
  /**
   * How much of the PREVIOUS presented frame to keep, 0..1. 0 means present
   * the new frame untouched; 0.75 means show a quarter of the new frame
   * blended over three quarters of the last one.
   */
  hold: number;
  /** Flashes counted in the trailing window, per WCAG pairing. */
  flashesInWindow: number;
  /**
   * Equivalent mitigation expressed as a luminance multiplier, 0..1, for
   * appliers that cannot blend against the previous frame.
   *
   * Holding frame N-1 under frame N and scaling both ends of a swing are
   * different pictures but the same WCAG arithmetic: the rule tests
   * |dL| >= 0.1 with the darker end below 0.8, and scaling luminance by k
   * scales every delta by k while only ever moving the darker end DOWN. So
   * a scrim is a valid mitigation, and it is the one that works identically
   * on WebGL and WebGPU without touching either pipeline — a black overlay
   * at alpha (1 - luminanceScale).
   */
  luminanceScale: number;
  /** True while the governor is actively holding frames back. */
  engaged: boolean;
  /** Whether THIS sample completed an opposing pair (i.e. was a flash). */
  flashed: boolean;
};

/**
 * Smallest grid where the 25%-of-a-visual-field rule can actually
 * discriminate.
 *
 * The field window is `round(cols/3) x round(rows/3)` tiles, so at 6x6 the
 * window is 2x2 and a SINGLE tile is exactly 25% of it — every isolated
 * flickering highlight trips the governor. The window needs at least 3x3
 * tiles (grid >= 8) before one tile falls under the threshold, and a 16x16
 * grid puts one tile at 4% of a 5x5 window, which leaves real headroom
 * between "a sparkle" and "a quarter of the visual field".
 *
 * Sampling finer costs almost nothing (256 luminance values per frame) and
 * is the difference between a governor and a blur filter.
 */
export const MIN_USEFUL_GRID = 8;
export const RECOMMENDED_GRID = 16;

const DEFAULTS = {
  limit: FLASHES_PER_SECOND_LIMIT,
  windowMs: 1000,
  engageAt: 2,
  engageHold: 0.2,
  escalatePerFlash: 0.02,
  safetyMargin: 0.8,
  holdCeiling: 0.97,
  releasePerFrame: 0.004,
  releaseDelayMs: 1500,
} as const;

export function createFlashGovernor(options: FlashGovernorOptions = {}) {
  const limit = options.limit ?? DEFAULTS.limit;
  const windowMs = options.windowMs ?? DEFAULTS.windowMs;
  const engageAt = Math.min(options.engageAt ?? DEFAULTS.engageAt, limit);
  const engageHold = options.engageHold ?? DEFAULTS.engageHold;
  const escalatePerFlash =
    options.escalatePerFlash ?? DEFAULTS.escalatePerFlash;
  const safetyMargin = options.safetyMargin ?? DEFAULTS.safetyMargin;
  const holdCeiling = options.holdCeiling ?? DEFAULTS.holdCeiling;
  const releasePerFrame = options.releasePerFrame ?? DEFAULTS.releasePerFrame;
  const releaseDelayMs = options.releaseDelayMs ?? DEFAULTS.releaseDelayMs;

  let previous: Float32Array | null = null;
  let previousCols = 0;
  let previousRows = 0;
  /** Direction of the last qualifying transition; null until one happens. */
  let lastDirection: boolean | null = null;
  /** Timestamps of completed flashes, oldest first. */
  const flashTimes: number[] = [];
  let hold = 0;
  /** When the window last became clear, for the release hold-off. */
  let clearSince: number | null = null;

  // Reused across frames so the hot path allocates nothing per sample.
  let rising: Float32Array | null = null;
  let falling: Float32Array | null = null;

  function reset() {
    previous = null;
    previousCols = 0;
    previousRows = 0;
    lastDirection = null;
    flashTimes.length = 0;
    hold = 0;
    clearSince = null;
  }

  function decision(flashed: boolean): FlashGovernorDecision {
    return {
      hold,
      luminanceScale: 1 - hold,
      flashesInWindow: flashTimes.length,
      engaged: hold > 0,
      flashed,
    };
  }

  /**
   * @param nowMs   Monotonic timestamp for this frame (performance.now()).
   * @param tiles   Row-major relative luminance per tile, each 0..1.
   */
  function sample(
    nowMs: number,
    tiles: Float32Array | readonly number[],
    cols: number,
    rows: number,
  ): FlashGovernorDecision {
    const count = cols * rows;
    if (count <= 0 || tiles.length < count) {
      return decision(false);
    }

    // A resolution change invalidates the comparison basis; treat it as a
    // fresh start rather than diffing grids of different shapes.
    if (!previous || previousCols !== cols || previousRows !== rows) {
      previous = new Float32Array(count);
      for (let i = 0; i < count; i += 1) previous[i] = tiles[i] as number;
      previousCols = cols;
      previousRows = rows;
      rising = new Float32Array(count);
      falling = new Float32Array(count);
      return decision(false);
    }

    const up = rising as Float32Array;
    const down = falling as Float32Array;
    // Largest qualifying swing this frame, in the luminance the VIEWER is
    // seeing — the caller scales the sample by the mitigation already in
    // force. This is what lets the response below be solved rather than
    // ramped.
    let peakDelta = 0;
    for (let i = 0; i < count; i += 1) {
      const before = previous[i] as number;
      const after = tiles[i] as number;
      const qualifies = isFlashTransition(before, after);
      up[i] = qualifies && after > before ? 1 : 0;
      down[i] = qualifies && after < before ? 1 : 0;
      if (qualifies) {
        const delta = Math.abs(after - before);
        if (delta > peakDelta) peakDelta = delta;
      }
    }

    // tilePixels = 1: a tile IS the unit here, unlike the offline harness
    // which counts qualifying pixels within each tile.
    const upFraction = peakWindowFraction(up, 1, cols, rows);
    const downFraction = peakWindowFraction(down, 1, cols, rows);

    let direction: boolean | null = null;
    if (upFraction >= FLASH_AREA_FRACTION && upFraction >= downFraction) {
      direction = true;
    } else if (downFraction >= FLASH_AREA_FRACTION) {
      direction = false;
    }

    let flashed = false;
    if (direction !== null) {
      if (lastDirection !== null && direction !== lastDirection) {
        // An opposing pair completes a flash.
        flashTimes.push(nowMs);
        flashed = true;
      }
      lastDirection = direction;
    }

    // Drop everything that has aged out of the trailing window.
    while (
      flashTimes.length > 0 &&
      nowMs - (flashTimes[0] as number) >= windowMs
    ) {
      flashTimes.shift();
    }

    const inWindow = flashTimes.length;
    if (inWindow >= engageAt) {
      // Ramp from engageAt (just starting) to limit (full strength), so the
      // response is proportionate rather than a cliff.
      const span = Math.max(1, limit - engageAt);
      const severity = Math.min(1, (inWindow - engageAt + 1) / span);
      hold = Math.max(hold, engageHold * severity);
      clearSince = null;
      if (flashed) {
        // A flash landed despite the clamp, so the clamp is not strong
        // enough for this content. Solve for the scale that puts the swing
        // just observed under the threshold, and compose it with whatever
        // is already applied (the sample was measured THROUGH that).
        let next = hold + escalatePerFlash;
        if (peakDelta > 0) {
          const currentScale = 1 - hold;
          const needed = (FLASH_LUMINANCE_DELTA * safetyMargin) / peakDelta;
          if (needed < 1) {
            next = Math.max(next, 1 - currentScale * needed);
          }
        }
        hold = Math.min(holdCeiling, next);
      }
    } else if (hold > 0) {
      // Only start easing off once the window has been quiet for a while:
      // it empties as soon as the clamp works, and releasing on that alone
      // is what produced the limit cycle described on releasePerFrame.
      if (clearSince === null) {
        clearSince = nowMs;
      } else if (nowMs - clearSince >= releaseDelayMs) {
        hold = Math.max(0, hold - releasePerFrame);
      }
    }

    previous.set(tiles as Float32Array, 0);
    return decision(flashed);
  }

  return {
    sample,
    reset,
    getState: () => decision(false),
  };
}

export type FlashGovernor = ReturnType<typeof createFlashGovernor>;
