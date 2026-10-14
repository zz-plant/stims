/**
 * Runtime photosensitive-flash governor: applies the WCAG 2.3.1 flash rule to
 * the frames being shown and decides how far to dim them.
 *
 * `analysis.ts` audits content offline: it can tell you that fifty videos
 * or presets are fine. It cannot say anything about content generated five
 * minutes ago, a file a user just imported, or a parameter a performer is
 * dragging live, which are exactly the cases that matter. This module
 * closes that gap by applying the SAME WCAG 2.3.1 rule to the frames
 * actually being shown, while they are being shown.
 *
 * Feed it a luminance field per frame, and the same samples' red-flash
 * values when the source has colour; it returns how hard to hold the
 * previous frame. Temporal integration is what a strobe cannot survive, so
 * holding is both the mitigation and (once the renderer applies it) the
 * reason the next sample stops qualifying as a flash.
 *
 * It is deliberately a pure state machine over samples rather than anything
 * that touches a canvas: the sampling strategy differs per backend and must
 * never stall the pipeline, but the DECISION should be identical everywhere
 * and testable without a GPU.
 *
 * Semantics inherited from thresholds.ts, matching the offline analysis:
 *   - a SAMPLE transition qualifies when |dL| >= 0.1 and the darker end < 0.8
 *   - a FRAME transition qualifies when qualifying samples cover >= 25% of
 *     any 10-degree visual field (a sliding third-by-third window of tiles,
 *     not the whole screen)
 *   - a *flash* is a PAIR of opposing transitions, so a monotonic fade is
 *     not a flash
 *   - more than 3 flashes in any 1-second window fails
 *   - red flashes are paired and counted the same way on their own channel,
 *     from the red-flash value and saturated-red test in thresholds.ts that
 *     the offline analysis uses, and engage the same clamp. Luminance alone
 *     cannot see them: (80,0,0) to (100,0,0) changes the red-flash value by
 *     25, over the limit of 20, and relative luminance by 0.01.
 *
 * This is a screen-content heuristic, not a medical device. It reduces
 * measured flash rate; it does not certify anything as safe.
 */
import {
  FLASH_AREA_FRACTION,
  FLASH_LUMINANCE_DELTA,
  FLASHES_PER_SECOND_LIMIT,
  isFlashTransition,
  isRedFlashTransition,
  peakWindowFraction,
  RED_FLASH_DELTA,
} from './thresholds.ts';

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
   *
   * Slow is not enough on its own while the content keeps strobing: a
   * release that stops only when flashes land again eases back to the
   * threshold every few seconds and lets them land. So while the content,
   * undimmed, still exceeds the limit, release stops at the largest scale
   * that holds the content's recent transitions under `safetyMargin` of the
   * threshold, instead of probing for the threshold.
   */
  releasePerFrame?: number;
  /**
   * How long the flash window must stay CLEAR before releasing begins, and
   * how long the content must stay under the limit before release may pass
   * its ceiling.
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
  /** General flashes counted in the trailing window, per WCAG pairing. */
  flashesInWindow: number;
  /**
   * Red flashes counted in the trailing window. Always 0 unless samples come
   * with `FlashSampleOptions.red`.
   */
  redFlashesInWindow: number;
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
  /**
   * Whether THIS sample completed an opposing pair of luminance transitions
   * (i.e. was a general flash).
   */
  flashed: boolean;
  /** Whether THIS sample completed an opposing pair of red transitions. */
  redFlashed: boolean;
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
 * analysis never sees. On a MilkDrop preset with fine moving texture
 * (Shifter - Curlique, 600 frames at 60fps, two GPU backends, landscape and
 * portrait) the per-pixel analysis read 0 flashes on every run and the
 * 16x16 read 12 to 49, enough to clamp the canvas to 3%. At 4 and 8 samples
 * per edge the same frames read 0, and on content that does strobe the
 * count tracks the per-pixel one (51 against 51 on one preset; 258 against
 * 248 on another, where one sample per tile read 380). 8 rather than 4 for
 * headroom: at 4 a field holds 400 samples, not 1,600, so its estimate of
 * the qualifying share has twice the standard error, and the governor acts
 * on the worst of 144 fields.
 *
 * Averaging each tile instead is not the fix either: WCAG decides magnitude
 * per pixel, and a tile mean scales a partial-coverage swing by its coverage
 * (see `peakWindowFraction`). Denser point samples, thresholded one by one,
 * are the audit's own method at a coarser stride.
 */
export const RECOMMENDED_SAMPLE_DENSITY = 8;

/**
 * The red-flash channel of a sampled field: the same samples as the
 * luminance field, in the same layout, reduced by the thresholds.ts
 * definitions the offline analysis uses (`frames.ts`).
 */
export type FlashRedField = {
  /** `redFlashValue(r, g, b)` per sample: max(0, R-G-B) * 320. */
  values: Float32Array | readonly number[];
  /** Nonzero where `isSaturatedRed(r, g, b)`: R/(R+G+B) >= 0.8. */
  saturated: Uint8Array | readonly number[];
};

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
   * canvas's whole brightness filter), 0..1. Defaults to 1.
   *
   * Passed rather than pre-multiplied into the samples so the governor can
   * tell content from its own step. Both frames of a comparison are judged at
   * THIS frame's scale: a swing the content makes is measured as the viewer
   * now sees it, which is what lets the loop converge, while the drop the
   * governor itself just applied does not register as content darkening.
   * Pre-scaled, that drop was a qualifying darkening across most of the
   * frame (189 of 256 tiles at its first engagement on the preset above,
   * none of it from content). Paired with the content's next brightening it
   * is a flash the content never made, which the governor answered by
   * clamping harder; controller.test.ts reproduces it.
   *
   * The red channel is judged at the same scale. The red-flash value is
   * linear in the sRGB channels, which a CSS brightness filter scales
   * directly, so a scale of k scales every red swing by k.
   */
  viewScale?: number;
  /**
   * The same samples' red-flash channel, so the WCAG red-flash criterion is
   * counted alongside the general one. Without it only general flashes are
   * counted, and a saturated-red strobe whose luminance barely moves passes
   * unmitigated. A sample that arrives without it ends the red comparison:
   * the next red sample starts afresh rather than diffing across the gap.
   */
  red?: FlashRedField;
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

/**
 * One WCAG channel's pairing state. General and red flashes are paired and
 * windowed separately, as the offline analysis counts them, and either
 * channel reaching `engageAt` engages the one clamp.
 */
type Channel = {
  /** Direction of the last qualifying transition; null until one happens. */
  lastDirection: boolean | null;
  /** Timestamps of completed flashes, oldest first. */
  flashTimes: number[];
};

/**
 * The largest scale at which one field-wide transition of the content, as
 * drawn, stays under `safetyMargin` of the threshold, per channel: 1 on a
 * channel the transition did not cross.
 */
type Ceiling = { time: number; general: number; red: number };

/**
 * Which way a frame transition qualified as a field-wide step, from its
 * qualifying samples per tile by direction, or null if neither covers 25%
 * of any visual field. When both do, the larger area wins.
 */
function fieldDirection(
  up: Float32Array,
  down: Float32Array,
  tilePixels: number,
  cols: number,
  rows: number,
): boolean | null {
  const upFraction = peakWindowFraction(up, tilePixels, cols, rows);
  const downFraction = peakWindowFraction(down, tilePixels, cols, rows);
  if (upFraction >= FLASH_AREA_FRACTION && upFraction >= downFraction) {
    return true;
  }
  if (downFraction >= FLASH_AREA_FRACTION) return false;
  return null;
}

/**
 * Records a field-wide step on a channel. An opposing pair completes a
 * flash, so a monotonic fade never does; returns whether this one did.
 */
function pairTransition(
  channel: Channel,
  direction: boolean | null,
  nowMs: number,
): boolean {
  if (direction === null) return false;
  const flashed =
    channel.lastDirection !== null && direction !== channel.lastDirection;
  if (flashed) channel.flashTimes.push(nowMs);
  channel.lastDirection = direction;
  return flashed;
}

/** Drops every flash that has aged out of the trailing window. */
function expireFlashes(channel: Channel, nowMs: number, windowMs: number) {
  while (
    channel.flashTimes.length > 0 &&
    nowMs - (channel.flashTimes[0] as number) >= windowMs
  ) {
    channel.flashTimes.shift();
  }
}

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
  /** The last red field as sampled, and whether the last sample had one. */
  let previousRed: Float32Array | null = null;
  let previousRedSaturated: Uint8Array | null = null;
  let hasPreviousRed = false;
  const general: Channel = { lastDirection: null, flashTimes: [] };
  const red: Channel = { lastDirection: null, flashTimes: [] };
  /**
   * The same pairing applied to the content as drawn, at full brightness:
   * what the viewer would see if the governor let go. Release reads it to
   * tell content that stopped strobing from content the clamp is hiding.
   */
  const drawnGeneral: Channel = { lastDirection: null, flashTimes: [] };
  const drawnRed: Channel = { lastDirection: null, flashTimes: [] };
  /** Ceilings of the content's recent field-wide transitions, oldest first. */
  const ceilings: Ceiling[] = [];
  /** When the content, undimmed, last had more than `limit` in the window. */
  let failingAt: number | null = null;
  let hold = 0;
  /** When the window last became clear, for the release hold-off. */
  let clearSince: number | null = null;

  // Reused across frames so the hot path allocates nothing per sample.
  /** Qualifying samples per tile, by direction, as seen and as drawn. */
  let rising: Float32Array | null = null;
  let falling: Float32Array | null = null;
  let redRising: Float32Array | null = null;
  let redFalling: Float32Array | null = null;
  let drawnRising: Float32Array | null = null;
  let drawnFalling: Float32Array | null = null;
  let drawnRedRising: Float32Array | null = null;
  let drawnRedFalling: Float32Array | null = null;
  /** Each sample's signed swing at the view scale, for the solved step. */
  let swings: Float32Array | null = null;
  let redSwings: Float32Array | null = null;
  /** Each sample's signed swing as drawn, for the content's ceiling. */
  let drawnSwings: Float32Array | null = null;
  let drawnRedSwings: Float32Array | null = null;
  /** Tile index of each sample. */
  let tileOf: Uint32Array | null = null;
  /** Scratch per-tile counts for the solved step, by direction. */
  let solveCounts: Float32Array | null = null;
  let solveFallingCounts: Float32Array | null = null;

  /**
   * Pre-applies a hold before any flash has been observed.
   *
   * The governor is reactive: it cannot suppress a flash it has not seen, so
   * the first one or two of an abrupt strobe reach the viewer while the
   * clamp is being solved. That is unavoidable when measurement is the only
   * input, but it is not the only input available. Content that was measured
   * offline (analysis.ts) and found to flash can start clamped instead of
   * being discovered the hard way; see `primingHoldForMeasurement`.
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
    hasPreviousRed = false;
    for (const channel of [general, red, drawnGeneral, drawnRed]) {
      channel.lastDirection = null;
      channel.flashTimes.length = 0;
    }
    ceilings.length = 0;
    failingAt = null;
    hold = 0;
    clearSince = null;
  }

  function decision(
    flashed: boolean,
    redFlashed: boolean,
  ): FlashGovernorDecision {
    return {
      hold,
      luminanceScale: 1 - hold,
      flashesInWindow: general.flashTimes.length,
      redFlashesInWindow: red.flashTimes.length,
      engaged: hold > 0,
      flashed,
      redFlashed,
    };
  }

  /** Keeps this sample's red field for the next comparison, if it has one. */
  function rememberRed(field: FlashRedField | null, count: number) {
    hasPreviousRed = field !== null;
    if (!field) return;
    const values = previousRed as Float32Array;
    const saturated = previousRedSaturated as Uint8Array;
    for (let i = 0; i < count; i += 1) {
      values[i] = field.values[i] as number;
      saturated[i] = field.saturated[i] ? 1 : 0;
    }
  }

  /**
   * The peak share of any visual field covered by samples of `field` whose
   * swing, scaled by `scale`, reaches `target`: in `direction`, or in
   * whichever direction covers more when `direction` is null.
   */
  function coverage(
    field: Float32Array,
    direction: boolean | null,
    target: number,
    scale: number,
    cols: number,
    rows: number,
    tilePixels: number,
  ): number {
    const counts = solveCounts as Float32Array;
    const fallingCounts = solveFallingCounts as Float32Array;
    const tiles = tileOf as Uint32Array;
    counts.fill(0);
    if (direction === null) fallingCounts.fill(0);
    for (let i = 0; i < field.length; i += 1) {
      const swing = field[i] as number;
      if (swing === 0 || Math.abs(swing) * scale < target) continue;
      const rising = swing > 0;
      if (direction !== null && rising !== direction) continue;
      const into = direction === null && !rising ? fallingCounts : counts;
      const tile = tiles[i] as number;
      into[tile] = (into[tile] as number) + 1;
    }
    const fraction = peakWindowFraction(counts, tilePixels, cols, rows);
    if (direction !== null) return fraction;
    return Math.max(
      fraction,
      peakWindowFraction(fallingCounts, tilePixels, cols, rows),
    );
  }

  /**
   * The extra luminance scale, on top of what the viewer already sees, that
   * puts the transition just observed under the area rule: the largest
   * scale at which samples swinging `direction` by at least the margin-scaled
   * threshold cover less than 25% of every visual field. A null `direction`
   * holds both directions under it, as a ceiling needs.
   *
   * Solved from the whole field rather than from its single largest swing.
   * One bright point crossing one sample is not what made the frame a flash,
   * and clamping until even that point stops qualifying took a calm preset
   * from full brightness to 9% on the first flash it saw. On a uniform
   * strobe the two agree.
   *
   * `field` holds the qualifying swings of one channel and `threshold` is
   * that channel's: `FLASH_LUMINANCE_DELTA` for luminance, `RED_FLASH_DELTA`
   * for the red-flash value. Scaling cannot change whether a sample is a
   * saturated red, so the red solve is exact; for luminance it assumes every
   * scaled swing has its darker end below 0.8, which only dimming makes
   * truer, so the answer errs toward clamping.
   */
  function solveScale(
    field: Float32Array,
    direction: boolean | null,
    threshold: number,
    cols: number,
    rows: number,
    density: number,
  ): number {
    const target = threshold * safetyMargin;
    const tilePixels = density * density;
    const under = (scale: number) =>
      coverage(field, direction, target, scale, cols, rows, tilePixels) <
      FLASH_AREA_FRACTION;
    // Coverage only grows with scale, so bisect for the largest scale that
    // stays under the area threshold. 12 steps resolve it to 1/4096. A field
    // already under it at full scale is under it at every scale.
    if (under(1)) return 1;
    let low = 0;
    let high = 1;
    for (let step = 0; step < 12; step += 1) {
      const mid = (low + high) / 2;
      if (under(mid)) low = mid;
      else high = mid;
    }
    return low;
  }

  /**
   * One transition's ceiling: the scale `solveScale` gives the content's
   * swings as drawn, in both directions, given the lowest ceiling already
   * recorded on the channel.
   *
   * A sustained strobe repeats one transition many times a second, and
   * solving every repeat cost several times what judging the sample does.
   * A transition under the area rule at `lowest` but not at 1/64 above it
   * has its ceiling in between, so it is recorded at `lowest`: never above
   * its own ceiling, so never more lenient. Anything else is solved.
   */
  function ceilingOf(
    field: Float32Array,
    threshold: number,
    lowest: number,
    cols: number,
    rows: number,
    density: number,
  ): number {
    if (lowest < 1) {
      const target = threshold * safetyMargin;
      const tilePixels = density * density;
      const above = Math.min(1, lowest * (1 + 1 / 64));
      if (
        coverage(field, null, target, lowest, cols, rows, tilePixels) <
          FLASH_AREA_FRACTION &&
        coverage(field, null, target, above, cols, rows, tilePixels) >=
          FLASH_AREA_FRACTION
      ) {
        return lowest;
      }
    }
    return solveScale(field, null, threshold, cols, rows, density);
  }

  /** The lowest ceiling recorded on one channel, 1 when there is none. */
  function lowestCeiling(channel: 'general' | 'red'): number {
    let lowest = 1;
    for (const entry of ceilings) lowest = Math.min(lowest, entry[channel]);
    return lowest;
  }

  /** Whether the content, undimmed, exceeded the limit within the hold-off. */
  function contentFailing(nowMs: number): boolean {
    return failingAt !== null && nowMs - failingAt < releaseDelayMs;
  }

  /**
   * The lowest hold release may reach.
   *
   * Release used to run until flashes landed again. Once the clamp had
   * emptied the window it eased back toward full brightness, crossed the
   * threshold on a strobe that had never stopped, and let flashes through
   * until two of them re-engaged it, every few seconds for as long as the
   * strobe lasted. On a 15 s saturated-red strobe just over the limit, the
   * 8-bit frames the viewer saw read 6 red flashes in one second, and a
   * luminance strobe just over the limit, judged with no rounding, read 4.
   *
   * The governor reads the content as drawn as well as through the clamp,
   * so it can tell the two cases apart. While the content itself has more
   * than `limit` flashes in the window, release stops at the largest scale
   * that holds every field-wide transition it made in the last
   * `windowMs + releaseDelayMs` under `safetyMargin` of the threshold: the
   * level the solved step aims for. Once the content has stayed at or under
   * the limit for `releaseDelayMs`, release runs to zero as before. Content
   * at or under the limit undimmed is never held by this floor; at most it
   * flashes as often as it would with no governor at all.
   *
   * A floor above the current hold tightens it. That happens when the
   * content grows stronger without crossing the threshold as seen, which
   * would otherwise leave it between the margin and the threshold.
   *
   * A ceiling is a scale on the content as drawn, and the hold is only the
   * governor's share of the view scale: `outside` is the rest (a brightness
   * setting composed into the same filter, say), so the hold only has to
   * make up the difference.
   */
  function releaseFloor(nowMs: number, outside: number): number {
    if (!contentFailing(nowMs)) return 0;
    const ceiling = Math.min(lowestCeiling('general'), lowestCeiling('red'));
    if (ceiling >= outside) return 0;
    return Math.min(holdCeiling, 1 - ceiling / outside);
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
      return decision(false, false);
    }
    const redField =
      options.red &&
      options.red.values.length >= count &&
      options.red.saturated.length >= count
        ? options.red
        : null;

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
      redRising = new Float32Array(tileCount);
      redFalling = new Float32Array(tileCount);
      drawnRising = new Float32Array(tileCount);
      drawnFalling = new Float32Array(tileCount);
      drawnRedRising = new Float32Array(tileCount);
      drawnRedFalling = new Float32Array(tileCount);
      solveCounts = new Float32Array(tileCount);
      solveFallingCounts = new Float32Array(tileCount);
      swings = new Float32Array(count);
      redSwings = new Float32Array(count);
      drawnSwings = new Float32Array(count);
      drawnRedSwings = new Float32Array(count);
      previousRed = new Float32Array(count);
      previousRedSaturated = new Uint8Array(count);
      tileOf = new Uint32Array(count);
      for (let i = 0; i < count; i += 1) {
        const x = i % width;
        const y = Math.floor(i / width);
        tileOf[i] = Math.floor(y / density) * cols + Math.floor(x / density);
      }
      rememberRed(redField, count);
      return decision(false, false);
    }

    const up = rising as Float32Array;
    const down = falling as Float32Array;
    const drawnUp = drawnRising as Float32Array;
    const drawnDown = drawnFalling as Float32Array;
    const field = swings as Float32Array;
    const drawnField = drawnSwings as Float32Array;
    const tiles = tileOf as Uint32Array;
    up.fill(0);
    down.fill(0);
    drawnUp.fill(0);
    drawnDown.fill(0);
    // Magnitude is decided per sample, before any spatial aggregation, as
    // the offline audit does per pixel; see RECOMMENDED_SAMPLE_DENSITY. Each
    // sample is judged as the viewer sees it, and as drawn. At a view scale
    // of 1 the two are the same judgement, so the second is skipped.
    const judgeDrawn = viewScale < 1;
    for (let i = 0; i < count; i += 1) {
      const drawnBefore = previous[i] as number;
      const drawnAfter = samples[i] as number;
      if (judgeDrawn) {
        drawnField[i] = drawnAfter - drawnBefore;
        if (isFlashTransition(drawnBefore, drawnAfter)) {
          const tile = tiles[i] as number;
          if (drawnAfter > drawnBefore) {
            drawnUp[tile] = (drawnUp[tile] as number) + 1;
          } else drawnDown[tile] = (drawnDown[tile] as number) + 1;
        }
      }
      const before = drawnBefore * viewScale;
      const after = drawnAfter * viewScale;
      const qualifies = isFlashTransition(before, after);
      field[i] = qualifies ? after - before : 0;
      if (!qualifies) continue;
      const tile = tiles[i] as number;
      if (after > before) up[tile] = (up[tile] as number) + 1;
      else down[tile] = (down[tile] as number) + 1;
    }

    const tilePixels = density * density;
    const direction = fieldDirection(up, down, tilePixels, cols, rows);
    const flashed = pairTransition(general, direction, nowMs);
    const drawnDirection = judgeDrawn
      ? fieldDirection(drawnUp, drawnDown, tilePixels, cols, rows)
      : direction;
    pairTransition(drawnGeneral, drawnDirection, nowMs);

    // The red channel, the same way: per sample, at the same view scale.
    let redDirection: boolean | null = null;
    let drawnRedDirection: boolean | null = null;
    if (redField && hasPreviousRed) {
      const redUp = redRising as Float32Array;
      const redDown = redFalling as Float32Array;
      const drawnRedUp = drawnRedRising as Float32Array;
      const drawnRedDown = drawnRedFalling as Float32Array;
      const redSwingField = redSwings as Float32Array;
      const drawnRedField = drawnRedSwings as Float32Array;
      const beforeValues = previousRed as Float32Array;
      const beforeSaturated = previousRedSaturated as Uint8Array;
      redUp.fill(0);
      redDown.fill(0);
      drawnRedUp.fill(0);
      drawnRedDown.fill(0);
      for (let i = 0; i < count; i += 1) {
        const drawnBefore = beforeValues[i] as number;
        const drawnAfter = redField.values[i] as number;
        const beforeRed = beforeSaturated[i] === 1;
        const afterRed = Boolean(redField.saturated[i]);
        if (judgeDrawn) {
          // Only a pair that touches a saturated red can be a red flash, at
          // any scale, so only those swings bound the ceiling.
          drawnRedField[i] =
            beforeRed || afterRed ? drawnAfter - drawnBefore : 0;
          if (
            isRedFlashTransition(drawnBefore, drawnAfter, beforeRed, afterRed)
          ) {
            const tile = tiles[i] as number;
            if (drawnAfter > drawnBefore) {
              drawnRedUp[tile] = (drawnRedUp[tile] as number) + 1;
            } else drawnRedDown[tile] = (drawnRedDown[tile] as number) + 1;
          }
        }
        const before = drawnBefore * viewScale;
        const after = drawnAfter * viewScale;
        const qualifies = isRedFlashTransition(
          before,
          after,
          beforeRed,
          afterRed,
        );
        redSwingField[i] = qualifies ? after - before : 0;
        if (!qualifies) continue;
        const tile = tiles[i] as number;
        if (after > before) redUp[tile] = (redUp[tile] as number) + 1;
        else redDown[tile] = (redDown[tile] as number) + 1;
      }
      redDirection = fieldDirection(redUp, redDown, tilePixels, cols, rows);
      drawnRedDirection = judgeDrawn
        ? fieldDirection(drawnRedUp, drawnRedDown, tilePixels, cols, rows)
        : redDirection;
    }
    const redFlashed = pairTransition(red, redDirection, nowMs);
    pairTransition(drawnRed, drawnRedDirection, nowMs);

    expireFlashes(general, nowMs, windowMs);
    expireFlashes(red, nowMs, windowMs);
    expireFlashes(drawnGeneral, nowMs, windowMs);
    expireFlashes(drawnRed, nowMs, windowMs);

    // What release may do depends on the content as drawn: see releaseFloor.
    if (
      Math.max(drawnGeneral.flashTimes.length, drawnRed.flashTimes.length) >
      limit
    ) {
      failingAt = nowMs;
    }
    while (
      ceilings.length > 0 &&
      nowMs - (ceilings[0] as Ceiling).time >= windowMs + releaseDelayMs
    ) {
      ceilings.shift();
    }
    // A ceiling is only ever read to release a held picture of content that
    // is failing, so only then is it worth computing. Release starts at
    // least `releaseDelayMs` after the clamp first engages, by which time
    // this has recorded the content's transitions. The drawn swings are only
    // measured under a view scale below 1, which a held picture has once the
    // hold reaches the screen.
    if (
      judgeDrawn &&
      hold > 0 &&
      contentFailing(nowMs) &&
      (drawnDirection !== null || drawnRedDirection !== null)
    ) {
      ceilings.push({
        time: nowMs,
        general:
          drawnDirection === null
            ? 1
            : ceilingOf(
                drawnField,
                FLASH_LUMINANCE_DELTA,
                lowestCeiling('general'),
                cols,
                rows,
                density,
              ),
        red:
          drawnRedDirection === null
            ? 1
            : ceilingOf(
                drawnRedSwings as Float32Array,
                RED_FLASH_DELTA,
                lowestCeiling('red'),
                cols,
                rows,
                density,
              ),
      });
    }

    const inWindow = Math.max(general.flashTimes.length, red.flashTimes.length);
    if (inWindow >= engageAt) {
      // Ramp from engageAt (just starting) to limit (full strength), so the
      // response is proportionate rather than a cliff.
      const span = Math.max(1, limit - engageAt);
      const severity = Math.min(1, (inWindow - engageAt + 1) / span);
      hold = Math.max(hold, engageHold * severity);
      clearSince = null;
      if (flashed || redFlashed) {
        // A flash landed despite the clamp, so the clamp is not strong
        // enough for this content. Solve for the scale that puts the
        // transition just observed under the threshold, and compose it with
        // whatever is already applied (the sample was measured THROUGH that).
        // A sample that flashed on both channels takes the stricter scale.
        const currentScale = 1 - hold;
        let needed = 1;
        if (flashed && direction !== null) {
          needed = Math.min(
            needed,
            solveScale(
              field,
              direction,
              FLASH_LUMINANCE_DELTA,
              cols,
              rows,
              density,
            ),
          );
        }
        if (redFlashed && redDirection !== null) {
          needed = Math.min(
            needed,
            solveScale(
              redSwings as Float32Array,
              redDirection,
              RED_FLASH_DELTA,
              cols,
              rows,
              density,
            ),
          );
        }
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
        // And only as far as the content allows. The sample was seen through
        // this hold, so the view scale's remainder is what lies outside it.
        const own = 1 - hold;
        const outside = own > 0 ? Math.min(1, viewScale / own) : 1;
        hold = Math.max(releaseFloor(nowMs, outside), hold - releasePerFrame);
      }
    }

    for (let i = 0; i < count; i += 1) previous[i] = samples[i] as number;
    rememberRed(redField, count);
    return decision(flashed, redFlashed);
  }

  return {
    sample,
    prime,
    reset,
    getState: () => decision(false, false),
  };
}

export type FlashGovernor = ReturnType<typeof createFlashGovernor>;

/**
 * How hard to pre-clamp content that was already measured offline.
 *
 * Derived from the same arithmetic the solved step uses, rather than a table
 * of taste: a swing of `maxLuminanceDelta` needs scaling by
 * `FLASH_LUMINANCE_DELTA * margin / maxLuminanceDelta` to fall under the
 * threshold, and the hold is the complement of that scale.
 *
 * Only content measured ABOVE the WCAG limit (`classifyFlashRisk` = 'high')
 * is primed. 'medium' content sits under the limit by definition, so
 * pre-dimming it would be a visible cost with no safety claim behind it; the
 * reactive path is the right answer there, and the offline measurement is a
 * coarse instrument besides.
 *
 * `maxLuminanceDelta` is the analysis's `maxFlashLuminanceDelta`: the swing
 * of the strongest flash, measured over a quarter of a visual field the way
 * the solved step measures the swing it clamps. Priming from it starts the
 * governor where solving that flash would have taken it. It is not
 * `luminanceVolatility`, a standard deviation of frame-mean changes: that
 * figure shrinks with the share of the screen that did not flash and with
 * how often the content holds still, so a hold derived from it says nothing
 * about how hard the content flashes.
 */
export function primingHoldForMeasurement(measurement: {
  flashRiskLevel?: string;
  maxLuminanceDelta?: number;
}): number {
  if (measurement.flashRiskLevel !== 'high') return 0;
  const delta = measurement.maxLuminanceDelta;
  if (!Number.isFinite(delta) || (delta as number) <= FLASH_LUMINANCE_DELTA) {
    // Measured as high-risk but without a usable swing figure (a profile
    // from before the audit recorded one, or content that is high on the
    // red channel alone): clamp gently rather than guessing hard, and let
    // the solved step take over.
    return 0.35;
  }
  const needed = (FLASH_LUMINANCE_DELTA * 0.8) / (delta as number);
  return Math.min(0.9, Math.max(0, 1 - needed));
}
