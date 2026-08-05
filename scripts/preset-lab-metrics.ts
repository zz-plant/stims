/**
 * Shared pure metrics for the preset lab
 * (`preset-lab-reactivity.ts` and `preset-lab-visual.ts`).
 *
 * Everything in this module is deterministic and side-effect free: the same
 * inputs always produce the same numbers. That property is what lets agents
 * without computer vision or hearing iterate on preset fidelity and audio
 * reactivity — the lab reports are numbers and verdicts, not pictures.
 *
 * Audio scenarios are band-isolated on purpose. The runtime derives bass/mid/
 * treble with ratio-based bins when no analyser sample rate is available
 * (`getBandLevels` in src/js/utils/audio/reactivity.ts: bass = first 12% of
 * bins, mid = 12–50%, treble = 50–100%), so each scenario fills exactly one of
 * those ranges. A correlation between the bass-pulse envelope and a preset
 * variable therefore isolates "does this preset respond to bass?".
 */

export type SeriesStats = {
  count: number;
  mean: number;
  min: number;
  max: number;
  stdDev: number;
};

export function summarizeSeries(values: readonly number[]): SeriesStats {
  if (values.length === 0) {
    return { count: 0, mean: 0, min: 0, max: 0, stdDev: 0 };
  }
  let total = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    total += value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const mean = total / values.length;
  let squareTotal = 0;
  for (const value of values) {
    squareTotal += (value - mean) * (value - mean);
  }
  return {
    count: values.length,
    mean,
    min,
    max,
    stdDev: Math.sqrt(squareTotal / values.length),
  };
}

/** Pearson correlation; returns 0 for degenerate (constant/empty) inputs. */
export function pearsonCorrelation(
  a: readonly number[],
  b: readonly number[],
): number {
  const length = Math.min(a.length, b.length);
  if (length < 2) {
    return 0;
  }
  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < length; index += 1) {
    meanA += a[index] ?? 0;
    meanB += b[index] ?? 0;
  }
  meanA /= length;
  meanB /= length;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < length; index += 1) {
    const deltaA = (a[index] ?? 0) - meanA;
    const deltaB = (b[index] ?? 0) - meanB;
    covariance += deltaA * deltaB;
    varianceA += deltaA * deltaA;
    varianceB += deltaB * deltaB;
  }
  if (varianceA <= 0 || varianceB <= 0) {
    return 0;
  }
  return covariance / Math.sqrt(varianceA * varianceB);
}

export type LaggedCorrelation = {
  correlation: number;
  lagFrames: number;
};

/**
 * Scans response lags of 0..maxLagFrames (response trailing the driver, the
 * physically meaningful direction for audio → visual) and returns the lag with
 * the strongest absolute correlation. Presets smooth their inputs, so peak
 * correlation a few frames late is normal and still counts as reactive.
 */
export function correlationWithLag(
  driver: readonly number[],
  response: readonly number[],
  maxLagFrames = 12,
): LaggedCorrelation {
  let best: LaggedCorrelation = {
    correlation: pearsonCorrelation(driver, response),
    lagFrames: 0,
  };
  const limit = Math.max(0, Math.min(maxLagFrames, response.length - 2));
  for (let lag = 1; lag <= limit; lag += 1) {
    const correlation = pearsonCorrelation(
      driver.slice(0, driver.length - lag),
      response.slice(lag),
    );
    if (Math.abs(correlation) > Math.abs(best.correlation)) {
      best = { correlation, lagFrames: lag };
    }
  }
  return best;
}

export const PRESET_LAB_SPECTRUM_BINS = 128;

/** Ratio-mode band edges used by `getBandLevels` when no sample rate exists. */
const BAND_EDGES = { bassEnd: 0.12, midEnd: 0.5 };

export type PresetLabScenario =
  | 'silence'
  | 'bass-pulse'
  | 'mid-pulse'
  | 'treble-pulse'
  | 'full-mix';

export const PRESET_LAB_SCENARIOS: readonly PresetLabScenario[] = [
  'silence',
  'bass-pulse',
  'mid-pulse',
  'treble-pulse',
  'full-mix',
];

export const AUDIO_DRIVEN_SCENARIOS: readonly PresetLabScenario[] = [
  'bass-pulse',
  'mid-pulse',
  'treble-pulse',
  'full-mix',
];

const SCENARIO_BPM = 120;
const BEAT_INTERVAL_MS = (60 / SCENARIO_BPM) * 1000;

/** Sharp attack, fast decay pulse train at 120 BPM. Range [0, 1]. */
export function scenarioPulseEnvelope(timeMs: number): number {
  const phase =
    ((timeMs % BEAT_INTERVAL_MS) + BEAT_INTERVAL_MS) % BEAT_INTERVAL_MS;
  return Math.max(0, 1 - (phase / BEAT_INTERVAL_MS) * 3);
}

function bandRangeForScenario(
  scenario: PresetLabScenario,
  binCount: number,
): { start: number; end: number } {
  if (scenario === 'bass-pulse') {
    return { start: 0, end: Math.ceil(binCount * BAND_EDGES.bassEnd) };
  }
  if (scenario === 'mid-pulse') {
    return {
      start: Math.ceil(binCount * BAND_EDGES.bassEnd),
      end: Math.floor(binCount * BAND_EDGES.midEnd),
    };
  }
  if (scenario === 'treble-pulse') {
    return { start: Math.floor(binCount * BAND_EDGES.midEnd), end: binCount };
  }
  return { start: 0, end: binCount };
}

/**
 * Fills `buffer` with the scenario's spectrum at `timeMs` and returns the
 * driving envelope value in [0, 1] for correlation bookkeeping.
 */
export function fillScenarioSpectrum(
  buffer: Uint8Array,
  scenario: PresetLabScenario,
  timeMs: number,
): number {
  buffer.fill(0);
  if (scenario === 'silence') {
    return 0;
  }

  const envelope = scenarioPulseEnvelope(timeMs);
  if (scenario === 'full-mix') {
    // Deterministic music-like mix: bass pulse train, sustained mid melody,
    // off-beat treble hats. Mirrors createSyntheticBeatFrequencyData but with
    // an explicit time input so runs are reproducible.
    const offbeatEnvelope = scenarioPulseEnvelope(
      timeMs + BEAT_INTERVAL_MS / 2,
    );
    for (let index = 0; index < buffer.length; index += 1) {
      const ratio = index / Math.max(1, buffer.length - 1);
      const bass = ratio < BAND_EDGES.bassEnd ? envelope * 230 : 0;
      const mid =
        ratio >= BAND_EDGES.bassEnd && ratio < BAND_EDGES.midEnd
          ? 90 + Math.sin(timeMs * 0.004 + index * 0.35) * 45
          : 0;
      const treble = ratio >= BAND_EDGES.midEnd ? offbeatEnvelope * 170 : 0;
      buffer[index] = Math.min(
        255,
        Math.max(0, Math.round(bass + mid + treble)),
      );
    }
    return envelope;
  }

  const { start, end } = bandRangeForScenario(scenario, buffer.length);
  const level = Math.round(envelope * 235);
  for (let index = start; index < end; index += 1) {
    buffer[index] = level;
  }
  return envelope;
}

/**
 * Fills a time-domain waveform buffer (128 = silence midpoint) whose amplitude
 * follows the scenario envelope, so waveform-driven presets react too.
 */
export function fillScenarioWaveform(
  buffer: Uint8Array,
  scenario: PresetLabScenario,
  timeMs: number,
): void {
  if (scenario === 'silence') {
    buffer.fill(128);
    return;
  }
  const envelope = scenarioPulseEnvelope(timeMs);
  const amplitude = 24 + envelope * 96;
  const cycles =
    scenario === 'treble-pulse' ? 12 : scenario === 'mid-pulse' ? 6 : 3;
  for (let index = 0; index < buffer.length; index += 1) {
    const ratio = index / Math.max(1, buffer.length - 1);
    const sample =
      128 + Math.sin(ratio * Math.PI * 2 * cycles + timeMs * 0.006) * amplitude;
    buffer[index] = Math.min(255, Math.max(0, Math.round(sample)));
  }
}

export type VariableScenarioMeasurement = {
  /** Envelope (or band level) series the preset was driven with. */
  driver: readonly number[];
  /** The variable's per-frame values under that scenario. */
  response: readonly number[];
};

export type VariableScenarioReactivity = {
  stdDev: number;
  correlation: number;
  lagFrames: number;
  /**
   * Whether the correlation was strongest against the variable's value or its
   * frame-to-frame delta. Accumulator variables (`x = x + vol*speed`, a very
   * common MilkDrop idiom) barely correlate by value but correlate strongly by
   * delta — audio drives their *rate of change*.
   */
  signal: 'value' | 'delta';
};

function differentiateSeries(values: readonly number[]): number[] {
  const deltas: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    deltas.push((values[index] ?? 0) - (values[index - 1] ?? 0));
  }
  return deltas;
}

export type VariableReactivity = {
  variable: string;
  silenceStdDev: number;
  scenarios: Record<string, VariableScenarioReactivity>;
  bestScenario: string | null;
  bestCorrelation: number;
  bestLagFrames: number;
  /** Max scenario stdDev relative to silence stdDev; >1 means audio adds motion. */
  responseRatio: number;
  verdict: 'reactive' | 'weak' | 'static' | 'autonomous';
};

const STATIC_STD_DEV = 1e-6;
const REACTIVE_CORRELATION = 0.3;
const REACTIVE_RESPONSE_RATIO = 1.25;
/** Audio multiplying a variable's variance this much counts as reactive even
 * without a clean linear correlation (threshold-triggered behavior). */
const VARIANCE_REACTIVE_RATIO = 3;

/**
 * Classifies one preset variable from its per-scenario series.
 *
 * - `reactive`: audio measurably drives the variable (correlated with a band
 *   envelope, or variance clearly rises when audio plays).
 * - `autonomous`: the variable moves on its own (time-driven) but audio does
 *   not change its behavior.
 * - `static`: the variable never moves in any scenario.
 * - `weak`: moves and is nominally audio-linked, but below thresholds.
 */
export function assessVariableReactivity(
  variable: string,
  silenceSeries: readonly number[],
  scenarioMeasurements: Record<string, VariableScenarioMeasurement>,
  maxLagFrames = 12,
): VariableReactivity {
  const silenceStdDev = summarizeSeries(silenceSeries).stdDev;
  const scenarios: Record<string, VariableScenarioReactivity> = {};
  let bestScenario: string | null = null;
  let bestCorrelation = 0;
  let bestLagFrames = 0;
  let maxScenarioStdDev = 0;

  for (const [scenario, measurement] of Object.entries(scenarioMeasurements)) {
    const stats = summarizeSeries(measurement.response);
    const byValue = correlationWithLag(
      measurement.driver,
      measurement.response,
      maxLagFrames,
    );
    const byDelta = correlationWithLag(
      measurement.driver.slice(1),
      differentiateSeries(measurement.response),
      maxLagFrames,
    );
    const strongest =
      Math.abs(byDelta.correlation) > Math.abs(byValue.correlation)
        ? { ...byDelta, signal: 'delta' as const }
        : { ...byValue, signal: 'value' as const };
    scenarios[scenario] = {
      stdDev: stats.stdDev,
      correlation: strongest.correlation,
      lagFrames: strongest.lagFrames,
      signal: strongest.signal,
    };
    maxScenarioStdDev = Math.max(maxScenarioStdDev, stats.stdDev);
    if (Math.abs(strongest.correlation) > Math.abs(bestCorrelation)) {
      bestCorrelation = strongest.correlation;
      bestLagFrames = strongest.lagFrames;
      bestScenario = scenario;
    }
  }

  const responseRatio =
    maxScenarioStdDev / Math.max(silenceStdDev, STATIC_STD_DEV);

  let verdict: VariableReactivity['verdict'];
  if (maxScenarioStdDev <= STATIC_STD_DEV && silenceStdDev <= STATIC_STD_DEV) {
    verdict = 'static';
  } else if (Math.abs(bestCorrelation) >= REACTIVE_CORRELATION) {
    // Correlated (by value or by delta) with a band envelope. Response ratio
    // is not required: audio can modulate an already-moving variable.
    verdict = 'reactive';
  } else if (
    responseRatio >= VARIANCE_REACTIVE_RATIO &&
    maxScenarioStdDev > STATIC_STD_DEV
  ) {
    // No clean linear correlation, but audio multiplies the variable's
    // variance — threshold/branch-triggered reactivity.
    verdict = 'reactive';
  } else if (
    silenceStdDev > STATIC_STD_DEV &&
    responseRatio < REACTIVE_RESPONSE_RATIO
  ) {
    verdict = 'autonomous';
  } else {
    verdict = 'weak';
  }

  return {
    variable,
    silenceStdDev,
    scenarios,
    bestScenario,
    bestCorrelation,
    bestLagFrames,
    responseRatio,
    verdict,
  };
}

export type RawImage = {
  data: Uint8Array | Buffer;
  width: number;
  height: number;
  channels: number;
};

export type ImageMetrics = {
  meanLuminance: number;
  luminanceStdDev: number;
  /** Fraction of pixels with luminance > 8 (out of 255). */
  visiblePixelRatio: number;
  /** Mean per-pixel chroma spread (max−min channel), 0..1. 0 = grayscale. */
  colorfulness: number;
  /** Fraction of pixels with any channel at ≥ 250 (blown-out highlights). */
  clippedHighlightRatio: number;
  nearBlack: boolean;
};

const VISIBLE_LUMINANCE = 8;
const NEAR_BLACK_MEAN_LUMINANCE = 2;
const NEAR_BLACK_VISIBLE_RATIO = 0.002;

export function computeImageMetrics(image: RawImage): ImageMetrics {
  const { data, width, height, channels } = image;
  const pixelCount = width * height;
  let luminanceTotal = 0;
  let luminanceSquareTotal = 0;
  let visiblePixels = 0;
  let chromaTotal = 0;
  let clippedPixels = 0;

  for (let offset = 0; offset < data.length; offset += channels) {
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    luminanceTotal += luminance;
    luminanceSquareTotal += luminance * luminance;
    if (luminance > VISIBLE_LUMINANCE) {
      visiblePixels += 1;
    }
    chromaTotal +=
      (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
    if (red >= 250 || green >= 250 || blue >= 250) {
      clippedPixels += 1;
    }
  }

  const meanLuminance = pixelCount > 0 ? luminanceTotal / pixelCount : 0;
  const variance =
    pixelCount > 0
      ? Math.max(
          0,
          luminanceSquareTotal / pixelCount - meanLuminance * meanLuminance,
        )
      : 0;
  const visiblePixelRatio = pixelCount > 0 ? visiblePixels / pixelCount : 0;

  return {
    meanLuminance,
    luminanceStdDev: Math.sqrt(variance),
    visiblePixelRatio,
    colorfulness: pixelCount > 0 ? chromaTotal / pixelCount : 0,
    clippedHighlightRatio: pixelCount > 0 ? clippedPixels / pixelCount : 0,
    nearBlack:
      meanLuminance <= NEAR_BLACK_MEAN_LUMINANCE &&
      visiblePixelRatio <= NEAR_BLACK_VISIBLE_RATIO,
  };
}

/** Fraction of pixels whose any RGB channel changed by more than `threshold`. */
export function computeChangedPixelRatio(
  first: RawImage,
  second: RawImage,
  threshold = 4,
): number {
  if (
    first.width !== second.width ||
    first.height !== second.height ||
    first.channels !== second.channels
  ) {
    return 1;
  }
  const pixelCount = first.width * first.height;
  if (pixelCount === 0) {
    return 0;
  }
  let changedPixels = 0;
  for (let offset = 0; offset < first.data.length; offset += first.channels) {
    const changed =
      Math.abs((first.data[offset] ?? 0) - (second.data[offset] ?? 0)) >
        threshold ||
      Math.abs((first.data[offset + 1] ?? 0) - (second.data[offset + 1] ?? 0)) >
        threshold ||
      Math.abs((first.data[offset + 2] ?? 0) - (second.data[offset + 2] ?? 0)) >
        threshold;
    if (changed) {
      changedPixels += 1;
    }
  }
  return changedPixels / pixelCount;
}

export type MetricComparisonSpec = {
  key: string;
  label: string;
  betterWhen: 'higher' | 'lower';
  /** Absolute delta below which the metric counts as unchanged. */
  tolerance: number;
};

export type MetricDelta = {
  key: string;
  label: string;
  baseline: number | null;
  current: number | null;
  delta: number | null;
  direction: 'improved' | 'regressed' | 'unchanged' | 'missing';
};

export function compareMetricRecords(
  specs: readonly MetricComparisonSpec[],
  baseline: Record<string, number | null | undefined>,
  current: Record<string, number | null | undefined>,
): MetricDelta[] {
  return specs.map((spec) => {
    const baselineValue = baseline[spec.key];
    const currentValue = current[spec.key];
    if (
      typeof baselineValue !== 'number' ||
      Number.isNaN(baselineValue) ||
      typeof currentValue !== 'number' ||
      Number.isNaN(currentValue)
    ) {
      return {
        key: spec.key,
        label: spec.label,
        baseline: typeof baselineValue === 'number' ? baselineValue : null,
        current: typeof currentValue === 'number' ? currentValue : null,
        delta: null,
        direction: 'missing',
      };
    }
    const delta = currentValue - baselineValue;
    let direction: MetricDelta['direction'] = 'unchanged';
    if (Math.abs(delta) > spec.tolerance) {
      const better = spec.betterWhen === 'higher' ? delta > 0 : delta < 0;
      direction = better ? 'improved' : 'regressed';
    }
    return {
      key: spec.key,
      label: spec.label,
      baseline: baselineValue,
      current: currentValue,
      delta,
      direction,
    };
  });
}

const DELTA_GLYPH: Record<MetricDelta['direction'], string> = {
  improved: '▲ improved',
  regressed: '▼ REGRESSED',
  unchanged: '· unchanged',
  missing: '? missing',
};

export function formatMetricDeltaLines(
  deltas: readonly MetricDelta[],
): string[] {
  return deltas.map((delta) => {
    const baseline =
      delta.baseline === null ? 'n/a' : delta.baseline.toFixed(4);
    const current = delta.current === null ? 'n/a' : delta.current.toFixed(4);
    const change =
      delta.delta === null
        ? ''
        : ` (${delta.delta >= 0 ? '+' : ''}${delta.delta.toFixed(4)})`;
    return `${DELTA_GLYPH[delta.direction]}  ${delta.label}: ${baseline} → ${current}${change}`;
  });
}
