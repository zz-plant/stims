/**
 * Offline photosensitive-risk analysis of a frame sequence.
 *
 * Implements the WCAG 2.3.1 general flash threshold and the PEAT/Harding
 * red-flash criterion against a deterministic frame timeline. The maths
 * lives here, separate from anything that reads pixels, so it can be tested
 * against synthetic timelines rather than only against a live GPU.
 *
 * Definitions follow WCAG's own wording (see thresholds.ts):
 *   - A *flash* is a pair of opposing changes in relative luminance of 10%
 *     or more of maximum, where the darker image is below 0.80.
 *   - The threshold applies when the flashing area occupies more than 25%
 *     of *any 10 degree visual field*, not 25% of the screen. Frames are
 *     tiled and a field-sized window is slid across the grid, because a
 *     region that strobes at full contrast while covering a tenth of the
 *     display still fails the standard, and both a whole-frame mean and a
 *     screen-wide fraction score it as safe.
 *   - More than 3 flashes within any 1-second window fails.
 *
 * Two entry points share one implementation of the pairing and windowing:
 *   - `analyzeFlashEvents` takes per-transition, per-tile counts of
 *     qualifying pixels. Use it when you have pixels (see frames.ts).
 *   - `analyzeFlashTimeline` takes per-frame luminance grids. Use it when a
 *     renderer or a test hands you luminance directly.
 *
 * These are screen-content heuristics, not a medical device. They flag
 * content worth review; they do not certify anything as safe.
 */
import {
  FLASH_AREA_FRACTION,
  FLASH_LUMINANCE_DELTA,
  FLASHES_PER_SECOND_LIMIT,
  isFlashTransition,
  peakWindowFraction,
} from './thresholds.ts';

export interface FlashAnalysisInput {
  /**
   * Per-frame tile luminance grids, already in relative-luminance space
   * (0..1). Every frame must have the same tile count, laid out row-major
   * as `rows` x `cols`.
   */
  frames: ReadonlyArray<ArrayLike<number>>;
  /** Milliseconds between consecutive frames. */
  deltaMs: number;
  /** Grid width in tiles. Omit to treat the grid as one undivided field. */
  cols?: number;
  /** Grid height in tiles. Omit to treat the grid as one undivided field. */
  rows?: number;
}

export interface FlashAnalysis {
  /** Worst flashes-per-second across any 1 s sliding window. */
  peakFlashesPerSecond: number;
  /** Total qualifying flash events across the timeline. */
  totalFlashes: number;
  /** True when the timeline exceeds the WCAG general flash threshold. */
  exceedsThreshold: boolean;
  /** Worst red flashes-per-second across any 1 s sliding window. */
  peakRedFlashesPerSecond: number;
  /** Total qualifying red-flash events across the timeline. */
  totalRedFlashes: number;
  /** True when the timeline exceeds the WCAG red-flash threshold. */
  exceedsRedThreshold: boolean;
  /** Mean absolute frame-to-frame luminance change (0..1): motion energy. */
  motionEnergy: number;
  /**
   * Standard deviation of the frame-mean luminance change: volatility. A
   * whole-frame figure, so it is not the size of any flash: a strobe over a
   * third of the screen moves the frame mean by a third of its swing.
   */
  luminanceVolatility: number;
  /**
   * The luminance swing of the strongest general flash: over the transitions
   * that paired into flashes, the largest change that samples covering 25%
   * of a visual field all made in the same direction (`flashSwing`). It is
   * the figure the governor's solved step clamps against, so a brightness
   * scale of `FLASH_LUMINANCE_DELTA / maxFlashLuminanceDelta` puts every
   * measured flash at the threshold. 0 when nothing flashed, or when the
   * input carried no swings (`FlashCountInput.risingSwing`).
   */
  maxFlashLuminanceDelta: number;
  /** Mean relative luminance across the timeline. */
  meanLuminance: number;
  /** Frames analysed. */
  frameCount: number;
}

export interface FlashCountInput {
  /**
   * Per-transition, per-tile counts of sampled pixels that qualified as a
   * brightening flash step. `rising[i]` describes the transition between
   * source frames `i` and `i + 1`, laid out row-major as `rows` x `cols`.
   */
  rising: ReadonlyArray<ArrayLike<number>>;
  /** Same shape as `rising`, for darkening steps. */
  falling: ReadonlyArray<ArrayLike<number>>;
  /**
   * Optional red-flash channel: per-transition, per-tile counts of sampled
   * pixels whose red-flash value rose while moving to or from saturated
   * red. Same shape as `rising`. Omit when the capture has no colour data.
   */
  redRising?: ReadonlyArray<ArrayLike<number>>;
  /** Same shape as `redRising`, for falling red-flash steps. */
  redFalling?: ReadonlyArray<ArrayLike<number>>;
  /**
   * Optional, per transition: `flashSwing` of its brightening samples, 0 when
   * they do not cover 25% of a visual field. Same length as `rising`. Omit
   * it and `maxFlashLuminanceDelta` is 0.
   */
  risingSwing?: ArrayLike<number>;
  /** Same as `risingSwing`, for darkening samples. */
  fallingSwing?: ArrayLike<number>;
  /** Sampled pixels per tile: the denominator for the area test. */
  tilePixels: number;
  cols: number;
  rows: number;
  deltaMs: number;
  /** Mean relative luminance per source frame, for reporting only. */
  frameMeanLuminance?: readonly number[];
  /** Mean absolute luminance delta per transition, for reporting only. */
  frameMeanDelta?: readonly number[];
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

/** A field-wide step, with the swing it carried over the area rule. */
type Transition = { frame: number; rising: boolean; swing: number };

/**
 * Decide whether one frame transition qualifies as a field-wide step, and
 * in which direction, from the peak visual-field fractions of its rising
 * and falling pixels. When both directions qualify the larger wins.
 */
function classifyTransition(
  frame: number,
  upFraction: number,
  downFraction: number,
  into: Transition[],
  upSwing = 0,
  downSwing = 0,
) {
  if (upFraction >= FLASH_AREA_FRACTION && upFraction >= downFraction) {
    into.push({ frame, rising: true, swing: upSwing });
  } else if (downFraction >= FLASH_AREA_FRACTION) {
    into.push({ frame, rising: false, swing: downSwing });
  }
}

/**
 * A flash in WCAG terms is a *pair* of opposing changes, so directions are
 * paired rather than counted individually: a monotonic fade to white is not
 * a flash. Returns the frame index at which each flash completed, and the
 * largest swing among the transitions that formed one. A run of steps in one
 * direction counts whole once an opposing step closes it, so the swing errs
 * large, which is the safe side for a figure used to size a clamp.
 */
function pairFlashes(transitions: readonly Transition[]): {
  frames: number[];
  maxSwing: number;
} {
  const flashFrames: number[] = [];
  let lastDirection: boolean | null = null;
  let runSwing = 0;
  let maxSwing = 0;
  for (const t of transitions) {
    if (lastDirection !== null && t.rising !== lastDirection) {
      flashFrames.push(t.frame);
      maxSwing = Math.max(maxSwing, runSwing, t.swing);
      runSwing = t.swing;
    } else {
      runSwing = Math.max(runSwing, t.swing);
    }
    lastDirection = t.rising;
  }
  return { frames: flashFrames, maxSwing };
}

/**
 * The swing a frame transition carries over the area rule: the largest
 * luminance change d such that the samples that moved `rising` by at least
 * d, as flash steps, still cover 25% of some visual field. 0 if even all of
 * the qualifying samples do not.
 *
 * This is the figure a brightness clamp has to divide. Scaling the frame by
 * k leaves a flash exactly when the samples still swinging by 0.1 cover a
 * quarter of a field, which is when k * d >= 0.1; the governor's solved step
 * bisects for the same boundary. The largest single swing would overstate it
 * (one bright point is not what made the frame flash) and a frame mean would
 * understate it by the share of the screen that did not flash.
 *
 * `swings[i]` is sample i's signed luminance change, 0 where it was not a
 * flash step (`isFlashTransition`), and `tileOf[i]` its tile; the area is
 * judged as `peakWindowFraction` judges it.
 */
export function flashSwing(
  swings: ArrayLike<number>,
  tileOf: ArrayLike<number>,
  rising: boolean,
  tilePixels: number,
  cols: number,
  rows: number,
): number {
  return swingCovering(swings, tileOf, rising, cols * rows, (counts) =>
    peakWindowFraction(counts, tilePixels, cols, rows),
  );
}

/** `flashSwing` against any area measure, for the unshaped timeline path. */
function swingCovering(
  swings: ArrayLike<number>,
  tileOf: ArrayLike<number>,
  rising: boolean,
  tileCount: number,
  area: (counts: Float64Array) => number,
): number {
  const counts = new Float64Array(tileCount);
  const covers = (minSwing: number) => {
    counts.fill(0);
    for (let i = 0; i < swings.length; i += 1) {
      const swing = swings[i] as number;
      if (swing === 0 || swing > 0 !== rising) continue;
      if (Math.abs(swing) >= minSwing) {
        const tile = tileOf[i] as number;
        counts[tile] = (counts[tile] as number) + 1;
      }
    }
    return area(counts) >= FLASH_AREA_FRACTION;
  };
  if (!covers(FLASH_LUMINANCE_DELTA)) return 0;
  if (covers(1)) return 1;
  // Coverage only shrinks as the minimum grows, so bisect for the largest
  // minimum that still covers. 12 steps resolve it to about 1/4096.
  let low = FLASH_LUMINANCE_DELTA;
  let high = 1;
  for (let step = 0; step < 12; step += 1) {
    const mid = (low + high) / 2;
    if (covers(mid)) low = mid;
    else high = mid;
  }
  return low;
}

/** Most flashes completing within any window of `framesPerWindow` frames. */
function peakInWindow(
  flashFrames: readonly number[],
  framesPerWindow: number,
): number {
  let peak = 0;
  for (let i = 0; i < flashFrames.length; i += 1) {
    let count = 1;
    for (let j = i + 1; j < flashFrames.length; j += 1) {
      if (
        (flashFrames[j] as number) - (flashFrames[i] as number) <
        framesPerWindow
      ) {
        count += 1;
      } else break;
    }
    if (count > peak) peak = count;
  }
  return peak;
}

function countPairedFlashes(
  rising: ReadonlyArray<ArrayLike<number>>,
  falling: ReadonlyArray<ArrayLike<number>>,
  tilePixels: number,
  cols: number,
  rows: number,
  deltaMs: number,
  risingSwing?: ArrayLike<number>,
  fallingSwing?: ArrayLike<number>,
): { peak: number; total: number; maxSwing: number } {
  const transitionCount = Math.min(rising.length, falling.length);
  const transitions: Transition[] = [];
  for (let f = 0; f < transitionCount; f += 1) {
    const up = peakWindowFraction(
      rising[f] as ArrayLike<number>,
      tilePixels,
      cols,
      rows,
    );
    const down = peakWindowFraction(
      falling[f] as ArrayLike<number>,
      tilePixels,
      cols,
      rows,
    );
    classifyTransition(
      f + 1,
      up,
      down,
      transitions,
      risingSwing?.[f] ?? 0,
      fallingSwing?.[f] ?? 0,
    );
  }
  const flashes = pairFlashes(transitions);
  return {
    peak: peakInWindow(flashes.frames, 1000 / deltaMs),
    total: flashes.frames.length,
    maxSwing: flashes.maxSwing,
  };
}

function emptyAnalysis(frameCount: number): FlashAnalysis {
  return {
    peakFlashesPerSecond: 0,
    totalFlashes: 0,
    exceedsThreshold: false,
    peakRedFlashesPerSecond: 0,
    totalRedFlashes: 0,
    exceedsRedThreshold: false,
    motionEnergy: 0,
    luminanceVolatility: 0,
    maxFlashLuminanceDelta: 0,
    meanLuminance: 0,
    frameCount,
  };
}

/**
 * Qualifying-pixel counts in, flash rate out. This is the path a pixel
 * capture takes (frames.ts produces its input), and the only one that can
 * evaluate the red-flash criterion, since luminance grids carry no colour.
 */
export function analyzeFlashEvents(input: FlashCountInput): FlashAnalysis {
  const { rising, falling, tilePixels, cols, rows, deltaMs } = input;
  const transitionCount = Math.min(rising.length, falling.length);
  const result: FlashAnalysis = {
    ...emptyAnalysis(transitionCount + 1),
    motionEnergy: mean(input.frameMeanDelta ?? []),
    luminanceVolatility: stdDev(input.frameMeanDelta ?? []),
    meanLuminance: mean(input.frameMeanLuminance ?? []),
  };
  if (transitionCount === 0 || deltaMs <= 0 || tilePixels <= 0) return result;

  const general = countPairedFlashes(
    rising,
    falling,
    tilePixels,
    cols,
    rows,
    deltaMs,
    input.risingSwing,
    input.fallingSwing,
  );
  const red =
    input.redRising && input.redFalling
      ? countPairedFlashes(
          input.redRising,
          input.redFalling,
          tilePixels,
          cols,
          rows,
          deltaMs,
        )
      : { peak: 0, total: 0 };

  return {
    ...result,
    peakFlashesPerSecond: general.peak,
    totalFlashes: general.total,
    exceedsThreshold: general.peak > FLASHES_PER_SECOND_LIMIT,
    maxFlashLuminanceDelta: general.maxSwing,
    peakRedFlashesPerSecond: red.peak,
    totalRedFlashes: red.total,
    exceedsRedThreshold: red.peak > FLASHES_PER_SECOND_LIMIT,
  };
}

/**
 * Luminance grids in, flash rate out. Each tile is treated as one sampled
 * unit: magnitude is decided per tile against the full-scale threshold
 * before any spatial aggregation, because averaging first scales every
 * swing down by the flashing region's coverage.
 *
 * Without `cols` and `rows` there is no spatial layout to slide a visual
 * field across, so the area test degrades to the whole-field fraction
 * rather than pretending a flat array is a one-tile-tall screen.
 */
export function analyzeFlashTimeline(input: FlashAnalysisInput): FlashAnalysis {
  const { frames, deltaMs } = input;
  if (frames.length < 2 || deltaMs <= 0) return emptyAnalysis(frames.length);
  const first = frames[0] as ArrayLike<number>;
  const tileCount = first.length;
  if (tileCount === 0) return emptyAnalysis(frames.length);

  const cols = input.cols ?? tileCount;
  const rows = input.rows ?? 1;
  const shapeValid =
    input.cols != null &&
    input.rows != null &&
    cols > 0 &&
    rows > 0 &&
    cols * rows === tileCount;

  const up = new Float32Array(tileCount);
  const down = new Float32Array(tileCount);
  const swings = new Float32Array(tileCount);
  // Each tile is one sample here, so a sample's tile is its own index.
  const tileOf = Uint32Array.from({ length: tileCount }, (_, t) => t);
  const area = (counts: ArrayLike<number>) => {
    if (shapeValid) return peakWindowFraction(counts, 1, cols, rows);
    let total = 0;
    for (let t = 0; t < tileCount; t += 1) total += counts[t] as number;
    return total / tileCount;
  };
  const transitions: Transition[] = [];
  const frameDeltas: number[] = [];
  const frameMeans: number[] = [mean(Array.from(first))];

  for (let f = 1; f < frames.length; f += 1) {
    const prev = frames[f - 1] as ArrayLike<number>;
    const curr = frames[f] as ArrayLike<number>;
    let absDeltaTotal = 0;
    let lumTotal = 0;

    for (let t = 0; t < tileCount; t += 1) {
      const before = prev[t] ?? 0;
      const after = curr[t] ?? 0;
      lumTotal += after;
      absDeltaTotal += Math.abs(after - before);
      const qualifies = isFlashTransition(before, after);
      up[t] = qualifies && after > before ? 1 : 0;
      down[t] = qualifies && after < before ? 1 : 0;
      swings[t] = qualifies ? after - before : 0;
    }

    frameDeltas.push(absDeltaTotal / tileCount);
    frameMeans.push(lumTotal / tileCount);

    const upFraction = area(up);
    const downFraction = area(down);
    const swingOf = (rising: boolean, fraction: number) =>
      fraction >= FLASH_AREA_FRACTION
        ? swingCovering(swings, tileOf, rising, tileCount, area)
        : 0;
    classifyTransition(
      f,
      upFraction,
      downFraction,
      transitions,
      swingOf(true, upFraction),
      swingOf(false, downFraction),
    );
  }

  const flashes = pairFlashes(transitions);
  const peak = peakInWindow(flashes.frames, 1000 / deltaMs);

  return {
    ...emptyAnalysis(frames.length),
    peakFlashesPerSecond: peak,
    totalFlashes: flashes.frames.length,
    exceedsThreshold: peak > FLASHES_PER_SECOND_LIMIT,
    maxFlashLuminanceDelta: flashes.maxSwing,
    motionEnergy: mean(frameDeltas),
    luminanceVolatility: stdDev(frameDeltas),
    meanLuminance: mean(frameMeans),
  };
}
