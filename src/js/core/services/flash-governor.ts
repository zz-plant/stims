/**
 * Runtime photosensitive-flash governor: applies the WCAG 2.3.1 flash rule to
 * the frames being shown and decides how far to dim the stage.
 *
 * `scripts/flash-analysis.ts` audits presets offline: it can tell you that
 * fifty presets are fine. It cannot say anything about the preset an LLM
 * generated five minutes ago, or a preset a user just imported, or a
 * parameter the performer is dragging live — which are exactly the cases
 * that matter. This module closes that gap by applying the SAME WCAG 2.3.1
 * rule to the frames actually being shown, while they are being shown.
 *
 * Feed it a luminance field per frame; it returns how hard to hold the
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
 *   - a SAMPLE transition qualifies when |dL| >= 0.1 and the darker end < 0.8
 *   - a FRAME transition qualifies when qualifying samples cover >= 25% of
 *     any 10-degree visual field (a sliding third-by-third window of tiles,
 *     not the whole screen)
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

/**
 * Samples along each tile edge, so a tile is judged on 8x8 = 64 points and a
 * visual field on 1,600.
 *
 * One sample per tile looked like a tile measurement and was not one: the
 * browser's downscale to a 16x16 grid is a bilinear read of about four
 * pixels at each tile centre, so the governor judged a 10-degree field on
 * 25 points and took the worst of 144 overlapping fields. Fine moving
 * texture puts a few of those points through a 0.1 swing every frame, and
 * the worst field crossed 25% often enough to count flashes the per-pixel
 * audit never sees. On the first-run preset (shifter-curlique, 600 frames
 * at 60fps, WebGPU and WebGL, 1280x720 and 390x844) the audit read 0
 * flashes on every run and the 16x16 read 12 to 49, enough to clamp the
 * stage to 3%. At 4 and 8 samples per edge the same frames read 0, and on
 * presets that do strobe the count tracks the audit's (psychaos 51 against
 * 51; krash 258 against 248, where one sample per tile read 380). 8 rather
 * than 4 for headroom: at 4 a field holds 400 samples, not 1,600, so its
 * estimate of the qualifying share has twice the standard error, and the
 * governor acts on the worst of 144 fields.
 *
 * Averaging each tile instead is not the fix either: WCAG decides magnitude
 * per pixel, and a tile mean scales a partial-coverage swing by its coverage
 * (see `peakWindowFraction`). Denser point samples, thresholded one by one,
 * are the audit's own method at a coarser stride.
 */
export const RECOMMENDED_SAMPLE_DENSITY = 8;

export type FlashSampleOptions = {
  /**
   * Samples along each tile edge. The field is `cols * density` wide and
   * `rows * density` tall, row-major, and tile (tx, ty) owns the
   * density x density block at (tx * density, ty * density). Defaults to 1:
   * one value per tile.
   */
  density?: number;
  /**
   * The luminance scale the viewer is seeing these samples through (the
   * stage's whole brightness filter), 0..1. Defaults to 1.
   *
   * Passed rather than pre-multiplied into the samples so the governor can
   * tell content from its own step. Both frames of a comparison are judged at
   * THIS frame's scale: a swing the content makes is measured as the viewer
   * now sees it, which is what lets the loop converge, while the drop the
   * governor itself just applied does not register as content darkening.
   * Pre-scaled, that drop was a qualifying darkening across most of the
   * frame (189 of 256 tiles at the first engagement on the first-run preset,
   * none of it from content). Paired with the content's next brightening it
   * is a flash the content never made, which the governor answered by
   * clamping harder; tests/unit/flash-safety.test.ts reproduces it.
   */
  viewScale?: number;
};

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

  /** The last field as sampled, before any view scale. */
  let previous: Float32Array | null = null;
  let previousCols = 0;
  let previousRows = 0;
  let previousDensity = 0;
  /** Direction of the last qualifying transition; null until one happens. */
  let lastDirection: boolean | null = null;
  /** Timestamps of completed flashes, oldest first. */
  const flashTimes: number[] = [];
  let hold = 0;
  /** When the window last became clear, for the release hold-off. */
  let clearSince: number | null = null;

  // Reused across frames so the hot path allocates nothing per sample.
  /** Qualifying samples per tile, by direction. */
  let rising: Float32Array | null = null;
  let falling: Float32Array | null = null;
  /** Each sample's signed swing at the view scale, for the solved step. */
  let swings: Float32Array | null = null;
  /** Tile index of each sample. */
  let tileOf: Uint32Array | null = null;
  /** Scratch per-tile counts for the solved step. */
  let solveCounts: Float32Array | null = null;

  /**
   * Pre-applies a hold before any flash has been observed.
   *
   * The governor is reactive: it cannot suppress a flash it has not seen, so
   * the first one or two of an abrupt strobe reach the viewer while the
   * clamp is being solved. That is unavoidable when measurement is the only
   * input — but it is not the only input available. The catalog has already
   * measured most presets offline (sensory-profile.ts), so when a preset is
   * known to flash, the runtime can start clamped instead of discovering it
   * the hard way.
   *
   * A floor, not an override: a priming value never LOWERS an existing hold,
   * and the solved step is still free to tighten past it.
   */
  function prime(initialHold: number) {
    if (!Number.isFinite(initialHold) || initialHold <= 0) return;
    hold = Math.max(hold, Math.min(holdCeiling, initialHold));
  }

  function reset() {
    previous = null;
    previousCols = 0;
    previousRows = 0;
    previousDensity = 0;
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
   * The extra luminance scale, on top of what the viewer already sees, that
   * puts the transition just observed under the area rule: the largest
   * scale at which samples swinging `direction` by at least the margin-scaled
   * threshold cover less than 25% of every visual field.
   *
   * Solved from the whole field rather than from its single largest swing.
   * One bright point crossing one sample is not what made the frame a flash,
   * and clamping until even that point stops qualifying took the first-run
   * preset from full brightness to 9% on the first flash it saw. On a
   * uniform strobe the two agree.
   *
   * Assumes every scaled swing has its darker end below 0.8, which only
   * dimming makes truer, so the answer errs toward clamping.
   */
  function solveScale(
    direction: boolean,
    cols: number,
    rows: number,
    density: number,
  ): number {
    const field = swings as Float32Array;
    const counts = solveCounts as Float32Array;
    const target = FLASH_LUMINANCE_DELTA * safetyMargin;
    const tilePixels = density * density;
    const coverage = (scale: number) => {
      counts.fill(0);
      for (let i = 0; i < field.length; i += 1) {
        const swing = field[i] as number;
        if (swing > 0 !== direction || swing === 0) continue;
        if (Math.abs(swing) * scale >= target) {
          counts[(tileOf as Uint32Array)[i] as number] += 1;
        }
      }
      return peakWindowFraction(counts, tilePixels, cols, rows);
    };
    // Coverage only grows with scale, so bisect for the largest scale that
    // stays under the area threshold. 12 steps resolve it to 1/4096.
    let low = 0;
    let high = 1;
    for (let step = 0; step < 12; step += 1) {
      const mid = (low + high) / 2;
      if (coverage(mid) < FLASH_AREA_FRACTION) low = mid;
      else high = mid;
    }
    return low;
  }

  /**
   * @param nowMs   Monotonic timestamp for this frame (performance.now()).
   * @param samples Row-major relative luminance, each 0..1, laid out as
   *                described on `FlashSampleOptions.density`.
   * @param cols    Tiles across.
   * @param rows    Tiles down.
   */
  function sample(
    nowMs: number,
    samples: Float32Array | readonly number[],
    cols: number,
    rows: number,
    options: FlashSampleOptions = {},
  ): FlashGovernorDecision {
    const density = Math.max(1, Math.floor(options.density ?? 1));
    const viewScale = Math.min(1, Math.max(0, options.viewScale ?? 1));
    const tileCount = cols * rows;
    const width = cols * density;
    const count = tileCount * density * density;
    if (tileCount <= 0 || samples.length < count) {
      return decision(false);
    }

    // A resolution change invalidates the comparison basis; treat it as a
    // fresh start rather than diffing fields of different shapes.
    if (
      !previous ||
      previousCols !== cols ||
      previousRows !== rows ||
      previousDensity !== density
    ) {
      previous = new Float32Array(count);
      for (let i = 0; i < count; i += 1) previous[i] = samples[i] as number;
      previousCols = cols;
      previousRows = rows;
      previousDensity = density;
      rising = new Float32Array(tileCount);
      falling = new Float32Array(tileCount);
      solveCounts = new Float32Array(tileCount);
      swings = new Float32Array(count);
      tileOf = new Uint32Array(count);
      for (let i = 0; i < count; i += 1) {
        const x = i % width;
        const y = Math.floor(i / width);
        tileOf[i] = Math.floor(y / density) * cols + Math.floor(x / density);
      }
      return decision(false);
    }

    const up = rising as Float32Array;
    const down = falling as Float32Array;
    const field = swings as Float32Array;
    const tiles = tileOf as Uint32Array;
    up.fill(0);
    down.fill(0);
    // Magnitude is decided per sample, before any spatial aggregation, as
    // the offline audit does per pixel; see RECOMMENDED_SAMPLE_DENSITY.
    for (let i = 0; i < count; i += 1) {
      const before = (previous[i] as number) * viewScale;
      const after = (samples[i] as number) * viewScale;
      const qualifies = isFlashTransition(before, after);
      field[i] = qualifies ? after - before : 0;
      if (!qualifies) continue;
      if (after > before) up[tiles[i] as number] += 1;
      else down[tiles[i] as number] += 1;
    }

    const tilePixels = density * density;
    const upFraction = peakWindowFraction(up, tilePixels, cols, rows);
    const downFraction = peakWindowFraction(down, tilePixels, cols, rows);

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
      if (flashed && direction !== null) {
        // A flash landed despite the clamp, so the clamp is not strong
        // enough for this content. Solve for the scale that puts the
        // transition just observed under the threshold, and compose it with
        // whatever is already applied (the sample was measured THROUGH that).
        const currentScale = 1 - hold;
        const needed = solveScale(direction, cols, rows, density);
        hold = Math.min(
          holdCeiling,
          Math.max(hold + escalatePerFlash, 1 - currentScale * needed),
        );
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

    for (let i = 0; i < count; i += 1) previous[i] = samples[i] as number;
    return decision(flashed);
  }

  return {
    sample,
    prime,
    reset,
    getState: () => decision(false),
  };
}

export type FlashGovernor = ReturnType<typeof createFlashGovernor>;

/**
 * How hard to pre-clamp a preset the catalog has already measured.
 *
 * Derived from the same arithmetic the solved step uses, rather than a table
 * of taste: a swing of `maxDelta` needs scaling by
 * `FLASH_LUMINANCE_DELTA * margin / maxDelta` to fall under the threshold,
 * and the hold is the complement of that scale.
 *
 * Only presets measured ABOVE the WCAG limit are primed. A 'medium' preset
 * sits under the limit by definition, so pre-dimming it would be a visible
 * cost with no safety claim behind it — the reactive path is the right
 * answer there, and the offline measurement is a coarse instrument besides.
 */
export function primingHoldForProfile(profile: {
  flashRiskLevel?: string;
  maxLuminanceDelta?: number;
}): number {
  if (profile.flashRiskLevel !== 'high') return 0;
  const delta = profile.maxLuminanceDelta;
  if (!Number.isFinite(delta) || (delta as number) <= FLASH_LUMINANCE_DELTA) {
    // Measured as high-risk but without a usable swing figure: clamp gently
    // rather than guessing hard, and let the solved step take over.
    return 0.35;
  }
  const needed = (FLASH_LUMINANCE_DELTA * 0.8) / (delta as number);
  return Math.min(0.9, Math.max(0, 1 - needed));
}
