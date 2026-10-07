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
  /** Standard deviation of frame-to-frame luminance change: volatility. */
  luminanceVolatility: number;
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

type Transition = { frame: number; rising: boolean };

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
) {
  if (upFraction >= FLASH_AREA_FRACTION && upFraction >= downFraction) {
    into.push({ frame, rising: true });
  } else if (downFraction >= FLASH_AREA_FRACTION) {
    into.push({ frame, rising: false });
  }
}

/**
 * A flash in WCAG terms is a *pair* of opposing changes, so directions are
 * paired rather than counted individually: a monotonic fade to white is not
 * a flash. Returns the frame index at which each flash completed.
 */
function pairFlashes(transitions: readonly Transition[]): number[] {
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
  return flashFrames;
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
): { peak: number; total: number } {
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
    classifyTransition(f + 1, up, down, transitions);
  }
  const flashFrames = pairFlashes(transitions);
  return {
    peak: peakInWindow(flashFrames, 1000 / deltaMs),
    total: flashFrames.length,
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
  const transitions: Transition[] = [];
  const frameDeltas: number[] = [];
  const frameMeans: number[] = [mean(Array.from(first))];

  for (let f = 1; f < frames.length; f += 1) {
    const prev = frames[f - 1] as ArrayLike<number>;
    const curr = frames[f] as ArrayLike<number>;
    let absDeltaTotal = 0;
    let upCount = 0;
    let downCount = 0;
    let lumTotal = 0;

    for (let t = 0; t < tileCount; t += 1) {
      const before = prev[t] ?? 0;
      const after = curr[t] ?? 0;
      lumTotal += after;
      absDeltaTotal += Math.abs(after - before);
      const qualifies = isFlashTransition(before, after);
      up[t] = qualifies && after > before ? 1 : 0;
      down[t] = qualifies && after < before ? 1 : 0;
      upCount += up[t] as number;
      downCount += down[t] as number;
    }

    frameDeltas.push(absDeltaTotal / tileCount);
    frameMeans.push(lumTotal / tileCount);

    const upFraction = shapeValid
      ? peakWindowFraction(up, 1, cols, rows)
      : upCount / tileCount;
    const downFraction = shapeValid
      ? peakWindowFraction(down, 1, cols, rows)
      : downCount / tileCount;
    classifyTransition(f, upFraction, downFraction, transitions);
  }

  const flashFrames = pairFlashes(transitions);
  const peak = peakInWindow(flashFrames, 1000 / deltaMs);

  return {
    ...emptyAnalysis(frames.length),
    peakFlashesPerSecond: peak,
    totalFlashes: flashFrames.length,
    exceedsThreshold: peak > FLASHES_PER_SECOND_LIMIT,
    motionEnergy: mean(frameDeltas),
    luminanceVolatility: stdDev(frameDeltas),
    meanLuminance: mean(frameMeans),
  };
}
