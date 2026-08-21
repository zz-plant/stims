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
  /** Strongest hold the governor will ask for, 0..1. */
  maxHold?: number;
  /**
   * Per-frame decay applied to `hold` once the window is clear again, so
   * the picture eases back instead of popping.
   */
  releasePerFrame?: number;
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
  maxHold: 0.85,
  releasePerFrame: 0.06,
} as const;

export function createFlashGovernor(options: FlashGovernorOptions = {}) {
  const limit = options.limit ?? DEFAULTS.limit;
  const windowMs = options.windowMs ?? DEFAULTS.windowMs;
  const engageAt = Math.min(options.engageAt ?? DEFAULTS.engageAt, limit);
  const maxHold = options.maxHold ?? DEFAULTS.maxHold;
  const releasePerFrame = options.releasePerFrame ?? DEFAULTS.releasePerFrame;

  let previous: Float32Array | null = null;
  let previousCols = 0;
  let previousRows = 0;
  /** Direction of the last qualifying transition; null until one happens. */
  let lastDirection: boolean | null = null;
  /** Timestamps of completed flashes, oldest first. */
  const flashTimes: number[] = [];
  let hold = 0;

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
  }

  function decision(flashed: boolean): FlashGovernorDecision {
    return {
      hold,
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
    for (let i = 0; i < count; i += 1) {
      const before = previous[i] as number;
      const after = tiles[i] as number;
      const qualifies = isFlashTransition(before, after);
      up[i] = qualifies && after > before ? 1 : 0;
      down[i] = qualifies && after < before ? 1 : 0;
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
      hold = Math.max(hold, maxHold * severity);
    } else if (hold > 0) {
      hold = Math.max(0, hold - releasePerFrame);
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
