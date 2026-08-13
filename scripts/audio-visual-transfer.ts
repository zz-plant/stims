/**
 * Audio->visual transfer characterization: given a known synthetic audio
 * stimulus (see `src/js/core/testing/synthetic-stimulus.ts`) and a measured
 * per-frame visual-response series (mean absolute luminance delta per
 * frame — the same reducer `analyze-preset-flash.ts` already computes for
 * flash detection), estimate how a preset's audio->visual mapping behaves:
 *
 *   - responsiveness: does visual magnitude track driving energy at all
 *     (Pearson correlation between the two series)?
 *   - latency: how many frames after an audio event does the visual
 *     response peak (cross-correlation lag)?
 *   - persistence: after the audio event ends, how many frames does the
 *     visual response take to decay back toward its pre-event baseline?
 *   - autonomy: under a *held-constant* stimulus, how much does the visual
 *     output still move on its own (feedback accumulation, internal
 *     timers) — variance of the response series with nothing driving it?
 *
 * The math lives here, separate from the Playwright harness in
 * analyze-preset-audio-response.ts, so it's unit-testable against synthetic
 * ground-truth arrays instead of only against a live GPU — the same split
 * flash-analysis.ts / analyze-preset-flash.ts uses.
 *
 * These are exploratory measurements for the Layer 1 research program in
 * docs/SENSORY_ACCESSIBILITY.md, not a certified property of any preset.
 */

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

/**
 * Pearson correlation coefficient between two equal-length series, in
 * [-1, 1]. Returns 0 for degenerate input (mismatched lengths, fewer than
 * 2 points, or a constant series with zero variance — undefined
 * correlation, not "no relationship", but 0 is the safer default for a
 * summary statistic than NaN propagating into a report).
 */
export function pearsonCorrelation(
  a: readonly number[],
  b: readonly number[],
): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const meanA = mean(a.slice(0, n));
  const meanB = mean(b.slice(0, n));
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  if (denom < 1e-12) return 0;
  return cov / denom;
}

export interface CrossCorrelationResult {
  /** The lag (in frames) at which correlation peaked. 0 means no delay. */
  lagFrames: number;
  /** The correlation coefficient at that lag. */
  correlation: number;
}

/**
 * Finds the non-negative lag (visual response can't precede its audio
 * cause) that maximizes correlation between `stimulus` and `response`
 * shifted later by that many frames. This is latency: how long after the
 * audio moves does the visual output follow.
 */
export function crossCorrelationLag(
  stimulus: readonly number[],
  response: readonly number[],
  maxLagFrames: number,
): CrossCorrelationResult {
  let best: CrossCorrelationResult = { lagFrames: 0, correlation: 0 };
  const n = Math.min(stimulus.length, response.length);
  const cappedLag = Math.max(0, Math.min(maxLagFrames, n - 2));
  for (let lag = 0; lag <= cappedLag; lag += 1) {
    const a = stimulus.slice(0, n - lag);
    const b = response.slice(lag, n);
    const correlation = pearsonCorrelation(a, b);
    if (Math.abs(correlation) > Math.abs(best.correlation)) {
      best = { lagFrames: lag, correlation };
    }
  }
  return best;
}

/**
 * Frames from `peakFrame` until `response` decays back within
 * `thresholdFraction` of the peak-to-baseline swing, toward
 * `preStimulusBaseline`. Returns null if it never decays within the
 * observed window (a real, reportable outcome — not an error) and 0 if
 * there was no swing to decay from in the first place.
 */
export function decayPersistenceFrames(
  response: readonly number[],
  peakFrame: number,
  preStimulusBaseline: number,
  thresholdFraction = 0.1,
): number | null {
  const peakValue = response[peakFrame] ?? preStimulusBaseline;
  const swing = Math.abs(peakValue - preStimulusBaseline);
  if (swing < 1e-9) return 0;
  const tolerance = swing * thresholdFraction;
  for (let i = peakFrame; i < response.length; i += 1) {
    if (Math.abs(response[i] - preStimulusBaseline) <= tolerance) {
      return i - peakFrame;
    }
  }
  return null;
}

/** Std-dev of the response series — how much it moves with nothing driving it. */
export function autonomyVariance(response: readonly number[]): number {
  return stdDev(response);
}
