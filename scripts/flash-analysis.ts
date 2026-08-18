/**
 * Photosensitive-risk analysis for rendered preset frames.
 *
 * Implements the WCAG 2.3.1 / 2.3.2 "general flash threshold" against a
 * deterministic frame timeline. The math lives here, separate from the
 * Playwright harness in analyze-preset-flash.ts, so it can be unit-tested
 * against synthetic timelines instead of only against a live GPU.
 *
 * Definitions follow WCAG's own wording:
 *   - A *flash* is a pair of opposing changes in relative luminance of 10%
 *     or more of maximum relative luminance, where the relative luminance
 *     of the darker image is below 0.80.
 *   - The threshold applies when the flashing area occupies more than 25%
 *     of *any 10 degree visual field*, not 25% of the screen. Frames are
 *     tiled and a field-sized window is slid across the grid, because a
 *     region that strobes at full contrast while covering a tenth of the
 *     display still fails the standard — and both a whole-frame mean and a
 *     screen-wide fraction score it as safe.
 *   - More than 3 flashes within any 1-second window fails.
 *
 * These are screen-content heuristics, not a medical device. They flag
 * presets worth review; they do not certify anything as safe.
 */

/** WCAG general flash threshold: >3 flashes in any 1s window fails. */
export const FLASHES_PER_SECOND_LIMIT = 3;
/**
 * Red-flash criterion (WCAG 2.3.1 via the PEAT/Harding working definition):
 * a saturated red is a color with R/(R+G+B) >= 0.8, and a transition
 * qualifies when it moves to or from a saturated red with a change in the
 * red-flash value max(0, R-G-B) * 320 greater than 20 (channels 0..1).
 */
export const RED_SATURATION_MIN = 0.8;
export const RED_FLASH_DELTA = 20;
export const RED_FLASH_SCALE = 320;
/** Luminance delta counting as a flash transition (10% of max). */
export const FLASH_LUMINANCE_DELTA = 0.1;
/** A flash only counts when the darker of the pair is below this. */
export const FLASH_DARKER_CEILING = 0.8;
/** Fraction of a 10-degree visual field that must change together. */
export const FLASH_AREA_FRACTION = 0.25;
/**
 * A 10-degree visual field at typical viewing distance covers roughly a
 * third of screen width and a third of screen height (WCAG's own worked
 * example: ~341x256px on a 1024x768 display). The area test slides a
 * window this size across the grid rather than measuring the whole screen
 * at once — a flash filling one small region entirely can exceed the
 * threshold inside that window while barely registering screen-wide.
 */
export const VISUAL_FIELD_FRACTION = 1 / 3;

export interface FlashAnalysisInput {
  /**
   * Per-frame tile luminance grids, already in relative-luminance space
   * (0..1). Every frame must have the same tile count, laid out row-major
   * as `rows` x `cols`.
   */
  frames: ReadonlyArray<ReadonlyArray<number>>;
  /** Simulated milliseconds between consecutive frames. */
  deltaMs: number;
  /** Grid width in tiles. Omit to treat the grid as a single row. */
  cols?: number;
  /** Grid height in tiles. Omit to treat the grid as a single row. */
  rows?: number;
}

export interface FlashAnalysis {
  /** Worst flashes-per-second across any 1s sliding window. */
  peakFlashesPerSecond: number;
  /** Total qualifying flash events across the timeline. */
  totalFlashes: number;
  /** True when the timeline exceeds the WCAG general flash threshold. */
  exceedsThreshold: boolean;
  /** Worst red flashes-per-second across any 1s sliding window. */
  peakRedFlashesPerSecond: number;
  /** Total qualifying red-flash events across the timeline. */
  totalRedFlashes: number;
  /** True when the timeline exceeds the WCAG red-flash threshold. */
  exceedsRedThreshold: boolean;
  /** Mean absolute frame-to-frame luminance change (0..1) — motion energy. */
  motionEnergy: number;
  /** Std-dev of frame-to-frame luminance change — volatility, not speed. */
  luminanceVolatility: number;
  /** Mean relative luminance across the timeline. */
  meanLuminance: number;
  /** Frames actually analysed. */
  frameCount: number;
}

/** sRGB byte -> linear-light component, per WCAG relative luminance. */
export function linearizeChannel(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance from sRGB bytes. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * linearizeChannel(r) +
    0.7152 * linearizeChannel(g) +
    0.0722 * linearizeChannel(b)
  );
}

/**
 * Whether a single tile's transition qualifies as a flash step: a large
 * enough swing, with the darker end dark enough to matter.
 */
export function isFlashTransition(before: number, after: number): boolean {
  return (
    Math.abs(after - before) >= FLASH_LUMINANCE_DELTA &&
    Math.min(before, after) < FLASH_DARKER_CEILING
  );
}

/** Red-flash value from sRGB bytes: max(0, R-G-B) scaled per PEAT. */
export function redFlashValue(r: number, g: number, b: number): number {
  return Math.max(0, (r - g - b) / 255) * RED_FLASH_SCALE;
}

/** Whether an sRGB byte triple is a saturated red (R/(R+G+B) >= 0.8). */
export function isSaturatedRed(r: number, g: number, b: number): boolean {
  const sum = r + g + b;
  return sum > 0 && r / sum >= RED_SATURATION_MIN;
}

/**
 * Whether a single pixel's transition qualifies as a red-flash step: it
 * moves to or from a saturated red with a large enough change in red-flash
 * value.
 */
export function isRedFlashTransition(
  beforeValue: number,
  afterValue: number,
  beforeSaturated: boolean,
  afterSaturated: boolean,
): boolean {
  return (
    (beforeSaturated || afterSaturated) &&
    Math.abs(afterValue - beforeValue) > RED_FLASH_DELTA
  );
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

function stdDev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) ** 2;
  return Math.sqrt(acc / values.length);
}

export interface FlashCountInput {
  /**
   * Per-transition, per-tile counts of sampled pixels that qualified as a
   * brightening flash step. `rising[i]` describes the transition between
   * source frames `i` and `i + 1`, laid out row-major as `rows` x `cols`.
   */
  rising: ReadonlyArray<ReadonlyArray<number>>;
  /** Same shape as `rising`, for darkening steps. */
  falling: ReadonlyArray<ReadonlyArray<number>>;
  /**
   * Optional red-flash channel: per-transition, per-tile counts of sampled
   * pixels whose red-flash value rose while moving to/from saturated red.
   * Same shape as `rising`. Omit when the capture path has no color data.
   */
  redRising?: ReadonlyArray<ReadonlyArray<number>>;
  /** Same shape as `redRising`, for falling red-flash steps. */
  redFalling?: ReadonlyArray<ReadonlyArray<number>>;
  /** Sampled pixels per tile — the denominator for the area test. */
  tilePixels: number;
  cols: number;
  rows: number;
  deltaMs: number;
  /** Mean relative luminance per source frame, for reporting only. */
  frameMeanLuminance?: readonly number[];
  /** Mean abs luminance delta per transition, for reporting only. */
  frameMeanDelta?: readonly number[];
}

/**
 * Largest fraction of any single 10-degree-field window that flashed —
 * the worst local case, not the screen average.
 *
 * `counts` holds qualifying *pixels* per tile, and `tilePixels` how many
 * were sampled per tile, so the window fraction is a true pixel-area
 * ratio. Magnitude was already decided per pixel by the caller: averaging
 * luminance before applying the threshold would scale every swing down by
 * the flashing region's coverage, and on sparse bright-on-black content
 * that shrinks real flashes below the threshold entirely.
 */
function peakWindowFraction(
  counts: readonly number[],
  tilePixels: number,
  cols: number,
  rows: number,
): number {
  const winW = Math.max(1, Math.round(cols * VISUAL_FIELD_FRACTION));
  const winH = Math.max(1, Math.round(rows * VISUAL_FIELD_FRACTION));
  const winPixels = winW * winH * tilePixels;
  if (winPixels <= 0) return 0;

  const sat = new Float64Array((rows + 1) * (cols + 1));
  for (let y = 0; y < rows; y += 1) {
    let rowRun = 0;
    for (let x = 0; x < cols; x += 1) {
      rowRun += counts[y * cols + x] ?? 0;
      sat[(y + 1) * (cols + 1) + (x + 1)] =
        sat[y * (cols + 1) + (x + 1)] + rowRun;
    }
  }

  let best = 0;
  for (let y = 0; y + winH <= rows; y += 1) {
    for (let x = 0; x + winW <= cols; x += 1) {
      const total =
        sat[(y + winH) * (cols + 1) + (x + winW)] -
        sat[y * (cols + 1) + (x + winW)] -
        sat[(y + winH) * (cols + 1) + x] +
        sat[y * (cols + 1) + x];
      const fraction = total / winPixels;
      if (fraction > best) best = fraction;
    }
  }
  return best;
}

/**
 * Core analysis: qualifying-pixel counts in, flash rate out. Both the
 * per-pixel harness path and the luminance-grid path below funnel through
 * this so the flash-pairing and 1-second-window logic exist once.
 */
function countPairedFlashes({
  rising,
  falling,
  tilePixels,
  cols,
  rows,
  deltaMs,
}: {
  rising: ReadonlyArray<ReadonlyArray<number>>;
  falling: ReadonlyArray<ReadonlyArray<number>>;
  tilePixels: number;
  cols: number;
  rows: number;
  deltaMs: number;
}): { peak: number; total: number } {
  const transitionCount = Math.min(rising.length, falling.length);

  // A "flash" in WCAG terms is a *pair* of opposing changes, so directions
  // are paired below rather than counted individually — a monotonic fade
  // to white is not a flash.
  const transitions: Array<{ frame: number; rising: boolean }> = [];
  for (let f = 0; f < transitionCount; f += 1) {
    const up = peakWindowFraction(rising[f], tilePixels, cols, rows);
    const down = peakWindowFraction(falling[f], tilePixels, cols, rows);
    if (up >= FLASH_AREA_FRACTION && up >= down) {
      transitions.push({ frame: f + 1, rising: true });
    } else if (down >= FLASH_AREA_FRACTION) {
      transitions.push({ frame: f + 1, rising: false });
    }
  }

  const flashFrames: number[] = [];
  let lastDirection: boolean | null = null;
  for (const t of transitions) {
    if (lastDirection === null) {
      lastDirection = t.rising;
      continue;
    }
    if (t.rising !== lastDirection) {
      flashFrames.push(t.frame);
      lastDirection = t.rising;
    }
  }

  const framesPerSecond = 1000 / deltaMs;
  let peak = 0;
  for (let i = 0; i < flashFrames.length; i += 1) {
    let count = 1;
    for (let j = i + 1; j < flashFrames.length; j += 1) {
      if (flashFrames[j] - flashFrames[i] < framesPerSecond) count += 1;
      else break;
    }
    if (count > peak) peak = count;
  }

  return { peak, total: flashFrames.length };
}

export function analyzeFlashEvents(input: FlashCountInput): FlashAnalysis {
  const { rising, falling, tilePixels, cols, rows, deltaMs } = input;
  const transitionCount = Math.min(rising.length, falling.length);
  const empty: FlashAnalysis = {
    peakFlashesPerSecond: 0,
    totalFlashes: 0,
    exceedsThreshold: false,
    peakRedFlashesPerSecond: 0,
    totalRedFlashes: 0,
    exceedsRedThreshold: false,
    motionEnergy: mean(input.frameMeanDelta ?? []),
    luminanceVolatility: stdDev(input.frameMeanDelta ?? []),
    meanLuminance: mean(input.frameMeanLuminance ?? []),
    frameCount: transitionCount + 1,
  };
  if (transitionCount === 0 || deltaMs <= 0 || tilePixels <= 0) return empty;

  const general = countPairedFlashes({
    rising,
    falling,
    tilePixels,
    cols,
    rows,
    deltaMs,
  });

  const red =
    input.redRising && input.redFalling
      ? countPairedFlashes({
          rising: input.redRising,
          falling: input.redFalling,
          tilePixels,
          cols,
          rows,
          deltaMs,
        })
      : { peak: 0, total: 0 };

  return {
    ...empty,
    peakFlashesPerSecond: general.peak,
    totalFlashes: general.total,
    exceedsThreshold: general.peak > FLASHES_PER_SECOND_LIMIT,
    peakRedFlashesPerSecond: red.peak,
    totalRedFlashes: red.total,
    exceedsRedThreshold: red.peak > FLASHES_PER_SECOND_LIMIT,
  };
}

function peakLocalFraction(
  flags: Int8Array,
  cols: number,
  rows: number,
  direction: 1 | -1,
): number {
  const winW = Math.max(1, Math.round(cols * VISUAL_FIELD_FRACTION));
  const winH = Math.max(1, Math.round(rows * VISUAL_FIELD_FRACTION));
  const winArea = winW * winH;

  // Summed-area table over the direction mask, so each candidate window is
  // an O(1) lookup instead of re-summing its tiles.
  const sat = new Int32Array((rows + 1) * (cols + 1));
  for (let y = 0; y < rows; y += 1) {
    let rowRun = 0;
    for (let x = 0; x < cols; x += 1) {
      rowRun += flags[y * cols + x] === direction ? 1 : 0;
      sat[(y + 1) * (cols + 1) + (x + 1)] =
        sat[y * (cols + 1) + (x + 1)] + rowRun;
    }
  }

  let best = 0;
  for (let y = 0; y + winH <= rows; y += 1) {
    for (let x = 0; x + winW <= cols; x += 1) {
      const total =
        sat[(y + winH) * (cols + 1) + (x + winW)] -
        sat[y * (cols + 1) + (x + winW)] -
        sat[(y + winH) * (cols + 1) + x] +
        sat[y * (cols + 1) + x];
      const fraction = total / winArea;
      if (fraction > best) best = fraction;
    }
  }
  return best;
}

export function analyzeFlashTimeline(input: FlashAnalysisInput): FlashAnalysis {
  const { frames, deltaMs } = input;
  // Luminance-grid input carries no color channels, so the red-flash
  // criterion cannot be evaluated on this path and reports zero.
  const empty: FlashAnalysis = {
    peakFlashesPerSecond: 0,
    totalFlashes: 0,
    exceedsThreshold: false,
    peakRedFlashesPerSecond: 0,
    totalRedFlashes: 0,
    exceedsRedThreshold: false,
    motionEnergy: 0,
    luminanceVolatility: 0,
    meanLuminance: 0,
    frameCount: frames.length,
  };
  if (frames.length < 2 || deltaMs <= 0) return empty;

  const tileCount = frames[0].length;
  if (tileCount === 0) return empty;

  // Direction of each qualifying whole-field transition, and the frame it
  // happened on. A "flash" in WCAG terms is a *pair* of opposing changes,
  // so brightenings and darkenings are paired up below rather than counted
  // individually — a monotonic fade to white is not a flash.
  const transitions: Array<{ frame: number; rising: boolean }> = [];
  const frameDeltas: number[] = [];
  const frameMeans: number[] = [mean(frames[0])];

  // Grid shape drives the 10-degree-field window.
  const cols = input.cols ?? tileCount;
  const rows = input.rows ?? 1;
  // Only window when the caller actually described a 2D grid. Without a
  // shape there is no spatial layout to slide a visual field across, so
  // the test degrades to the whole-field fraction rather than pretending
  // a flat array is a 1-pixel-tall screen.
  const shapeValid =
    input.cols != null &&
    input.rows != null &&
    cols > 0 &&
    rows > 0 &&
    cols * rows === tileCount;
  const flags = new Int8Array(tileCount);

  for (let f = 1; f < frames.length; f += 1) {
    const prev = frames[f - 1];
    const curr = frames[f];
    let absDeltaTotal = 0;
    flags.fill(0);

    for (let t = 0; t < tileCount; t += 1) {
      const before = prev[t] ?? 0;
      const after = curr[t] ?? 0;
      absDeltaTotal += Math.abs(after - before);
      if (!isFlashTransition(before, after)) continue;
      flags[t] = after > before ? 1 : -1;
    }

    frameDeltas.push(absDeltaTotal / tileCount);
    frameMeans.push(mean(curr));

    const risingFraction = shapeValid
      ? peakLocalFraction(flags, cols, rows, 1)
      : flags.reduce((n, v) => n + (v === 1 ? 1 : 0), 0) / tileCount;
    const fallingFraction = shapeValid
      ? peakLocalFraction(flags, cols, rows, -1)
      : flags.reduce((n, v) => n + (v === -1 ? 1 : 0), 0) / tileCount;

    if (risingFraction >= FLASH_AREA_FRACTION) {
      transitions.push({ frame: f, rising: true });
    } else if (fallingFraction >= FLASH_AREA_FRACTION) {
      transitions.push({ frame: f, rising: false });
    }
  }

  // Pair opposing transitions into flashes: each time the direction flips
  // relative to the previous counted transition, one flash completes.
  const flashFrames: number[] = [];
  let lastDirection: boolean | null = null;
  for (const t of transitions) {
    if (lastDirection === null) {
      lastDirection = t.rising;
      continue;
    }
    if (t.rising !== lastDirection) {
      flashFrames.push(t.frame);
      lastDirection = t.rising;
    }
  }

  // Peak flashes in any 1-second sliding window.
  const framesPerSecond = 1000 / deltaMs;
  let peak = 0;
  for (let i = 0; i < flashFrames.length; i += 1) {
    let count = 1;
    for (let j = i + 1; j < flashFrames.length; j += 1) {
      if (flashFrames[j] - flashFrames[i] < framesPerSecond) count += 1;
      else break;
    }
    if (count > peak) peak = count;
  }

  return {
    ...empty,
    peakFlashesPerSecond: peak,
    totalFlashes: flashFrames.length,
    exceedsThreshold: peak > FLASHES_PER_SECOND_LIMIT,
    motionEnergy: mean(frameDeltas),
    luminanceVolatility: stdDev(frameDeltas),
    meanLuminance: mean(frameMeans),
    frameCount: frames.length,
  };
}
