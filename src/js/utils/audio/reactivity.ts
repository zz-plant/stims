function getBandAverage(
  data: Uint8Array,
  startRatio: number,
  endRatio: number,
): number {
  if (data.length === 0) return 0;
  const clampedStart = Math.max(0, Math.min(1, startRatio));
  const clampedEnd = Math.max(0, Math.min(1, endRatio));
  const start = Math.max(0, Math.floor(data.length * clampedStart));
  const end = Math.min(data.length, Math.ceil(data.length * clampedEnd));
  if (end <= start) return 0;

  let sum = 0;
  for (let i = start; i < end; i += 1) {
    sum += data[i];
  }
  return sum / (end - start);
}

export type BandLevels = {
  bass: number;
  mid: number;
  treble: number;
};

export type BandRatios = {
  bass: number;
  mid: number;
};

export type BandWeights = {
  bass: number;
  mid: number;
  treble: number;
};

export type FrequencyBandRange = {
  minHz: number;
  maxHz: number;
};

export type FrequencyBandRanges = {
  bass: FrequencyBandRange;
  mid: FrequencyBandRange;
  treble: FrequencyBandRange;
};

const DEFAULT_RATIOS: BandRatios = { bass: 0.12, mid: 0.5 };
const DEFAULT_WEIGHTS: BandWeights = { bass: 0.6, mid: 0.25, treble: 0.15 };
export const DEFAULT_FREQUENCY_BAND_RANGES: FrequencyBandRanges = {
  bass: { minHz: 20, maxHz: 250 },
  mid: { minHz: 250, maxHz: 4000 },
  treble: { minHz: 4000, maxHz: 20000 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const bandIndexCache = new Map<string, { start: number; end: number }>();

function resolveBandIndexes(
  dataLength: number,
  sampleRate: number,
  range: FrequencyBandRange,
  fftSize: number,
) {
  if (dataLength <= 0 || sampleRate <= 0) {
    return { start: 0, end: 0 };
  }

  const cacheKey = `${dataLength}:${sampleRate}:${range.minHz}:${range.maxHz}:${fftSize}`;
  const cached = bandIndexCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const resolutionHz = sampleRate / fftSize;
  const nyquistHz = sampleRate / 2;
  const minHz = clamp(range.minHz, 0, nyquistHz);
  const maxHz = clamp(Math.max(minHz, range.maxHz), 0, nyquistHz);
  const startCandidate = Math.ceil(minHz / resolutionHz);
  const endCandidate = Math.ceil(maxHz / resolutionHz);
  let result: { start: number; end: number };

  if (endCandidate <= startCandidate) {
    const representative = clamp(
      Math.floor(((minHz + maxHz) * 0.5) / resolutionHz),
      0,
      dataLength - 1,
    );
    result = { start: representative, end: representative + 1 };
  } else {
    const start = clamp(startCandidate, 0, dataLength - 1);
    const end = clamp(endCandidate, start + 1, dataLength);
    result = { start, end };
  }

  if (bandIndexCache.size > 128) {
    bandIndexCache.clear();
  }
  bandIndexCache.set(cacheKey, result);
  return result;
}

function getBandAverageForRange(
  data: Uint8Array,
  sampleRate: number,
  range: FrequencyBandRange,
  band: keyof FrequencyBandRanges,
  fftSize: number,
): number {
  if (data.length === 0) return 0;

  const { start, end } = resolveBandIndexes(
    data.length,
    sampleRate,
    range,
    fftSize,
  );
  if (end <= start) return 0;

  let sum = 0;
  let weightTotal = 0;

  for (let index = start; index < end; index += 1) {
    const position =
      end - start <= 1 ? 0 : (index - start) / Math.max(1, end - start - 1);
    const weight =
      band === 'bass'
        ? 1.2 - position * 0.3
        : band === 'treble'
          ? 0.9 + position * 0.25
          : 1;
    sum += (data[index] ?? 0) * weight;
    weightTotal += weight;
  }

  return weightTotal > 0 ? sum / weightTotal : 0;
}

export function getFrequencyBandLevels(
  data: Uint8Array,
  sampleRate = 44100,
  bandRanges: FrequencyBandRanges = DEFAULT_FREQUENCY_BAND_RANGES,
  fftSize = data.length * 2,
): BandLevels {
  if (data.length === 0) {
    return { bass: 0, mid: 0, treble: 0 };
  }

  const resolvedFftSize =
    Number.isFinite(fftSize) && fftSize > 0 ? fftSize : data.length * 2;

  const bass =
    getBandAverageForRange(
      data,
      sampleRate,
      bandRanges.bass,
      'bass',
      resolvedFftSize,
    ) / 255;
  const mid =
    getBandAverageForRange(
      data,
      sampleRate,
      bandRanges.mid,
      'mid',
      resolvedFftSize,
    ) / 255;
  const treble =
    getBandAverageForRange(
      data,
      sampleRate,
      bandRanges.treble,
      'treble',
      resolvedFftSize,
    ) / 255;

  return { bass, mid, treble };
}

export type ExtendedBandLevels = BandLevels & {
  subBass: number;
  kick: number;
};

export function getExtendedFrequencyBandLevels(
  data: Uint8Array,
  sampleRate = 44100,
  bandRanges: FrequencyBandRanges = DEFAULT_FREQUENCY_BAND_RANGES,
  fftSize = data.length * 2,
): ExtendedBandLevels {
  const base = getFrequencyBandLevels(data, sampleRate, bandRanges, fftSize);
  if (data.length === 0) {
    return { ...base, subBass: 0, kick: 0 };
  }

  const resolvedFftSize =
    Number.isFinite(fftSize) && fftSize > 0 ? fftSize : data.length * 2;

  const subBassRange = { minHz: 24, maxHz: 60 };
  const kickRange = { minHz: 60, maxHz: 250 };

  const subBass =
    getBandAverageForRange(
      data,
      sampleRate,
      subBassRange,
      'bass',
      resolvedFftSize,
    ) / 255;

  const kick =
    getBandAverageForRange(
      data,
      sampleRate,
      kickRange,
      'bass',
      resolvedFftSize,
    ) / 255;

  return {
    ...base,
    subBass,
    kick,
  };
}

export type FourBandTransientMetrics = {
  subBassEnv: number;
  kickTransient: number;
  vocalMidEnv: number;
  snareSnap: number;
};

export function getFourBandTransientMetrics(
  data: Uint8Array,
  previousData?: Uint8Array,
  sampleRate = 44100,
): FourBandTransientMetrics {
  if (data.length === 0) {
    return { subBassEnv: 0, kickTransient: 0, vocalMidEnv: 0, snareSnap: 0 };
  }

  const ext = getExtendedFrequencyBandLevels(data, sampleRate);
  const prevExt = previousData?.length
    ? getExtendedFrequencyBandLevels(previousData, sampleRate)
    : { subBass: 0, kick: 0, mid: 0, treble: 0 };

  const subBassEnv = Math.min(1, ext.subBass * 1.35);
  const kickDelta = Math.max(0, ext.kick - prevExt.kick);
  const kickTransient = Math.min(1, kickDelta * 3.8 + ext.kick * 0.4);

  const vocalMidEnv = Math.min(1, ext.mid * 1.2);
  const snareDelta = Math.max(0, ext.treble - prevExt.treble);
  const snareSnap = Math.min(1, snareDelta * 4.2 + ext.treble * 0.3);

  return {
    subBassEnv,
    kickTransient,
    vocalMidEnv,
    snareSnap,
  };
}

export function getBandLevels({
  analyser,
  data,
  sampleRate,
  ratios = DEFAULT_RATIOS,
  bandRanges = DEFAULT_FREQUENCY_BAND_RANGES,
}: {
  analyser?: {
    getMultiBandEnergy?: (data?: Uint8Array) => BandLevels | null;
  } | null;
  data: Uint8Array;
  sampleRate?: number;
  ratios?: BandRatios;
  bandRanges?: FrequencyBandRanges;
}): BandLevels {
  const fromAnalyser = analyser?.getMultiBandEnergy?.(data);
  if (fromAnalyser) return fromAnalyser;

  if (Number.isFinite(sampleRate) && (sampleRate ?? 0) > 0) {
    return getFrequencyBandLevels(data, sampleRate, bandRanges);
  }

  const bass = getBandAverage(data, 0, ratios.bass) / 255;
  const mid = getBandAverage(data, ratios.bass, ratios.mid) / 255;
  const treble = getBandAverage(data, ratios.mid, 1) / 255;

  return { bass, mid, treble };
}

export function getWeightedEnergy(
  bands: BandLevels,
  {
    weights = DEFAULT_WEIGHTS,
    boost = 1.35,
  }: { weights?: BandWeights; boost?: number } = {},
): number {
  const weighted =
    bands.bass * weights.bass +
    bands.mid * weights.mid +
    bands.treble * weights.treble;

  return Math.min(1, weighted * boost);
}

export function updateEnergyPeak(
  currentPeak: number,
  weightedEnergy: number,
  { decay = 0.96, floor = 0.02 }: { decay?: number; floor?: number } = {},
): number {
  return Math.max(currentPeak * decay, weightedEnergy, floor);
}

/**
 * Boost-only auto-gain for byte waveforms headed to the visualizer.
 *
 * MilkDrop presets draw the raw time-domain wave and are written against
 * music that sits near full scale; a quiet source (the 0.12-gain demo track,
 * a soft microphone) parks every byte at 128 +/- a few counts and the drawn
 * wave collapses to a flat line while the spectrum path — which is dB-scaled
 * and band-normalized — keeps reacting. This is the waveform-side analogue of
 * that normalization: track the recent peak deviation from center and scale
 * up toward a target amplitude. Never attenuates (gain floor 1), so sources
 * that are already healthy pass through untouched, and a noise floor keeps
 * true silence from being amplified into garbage.
 */
export function createWaveformAutoGain({
  targetAmplitude = 96,
  maxGain = 8,
  noiseFloor = 3,
  peakDecay = 0.985,
}: {
  /** Desired peak deviation from the 128 center, in byte counts. */
  targetAmplitude?: number;
  /** Upper bound on amplification, so hiss cannot be blown up to full scale. */
  maxGain?: number;
  /** Peak deviations below this (byte counts) are treated as silence. */
  noiseFloor?: number;
  /** Per-call decay of the tracked peak; attack is instantaneous. */
  peakDecay?: number;
} = {}) {
  let trackedPeak = 0;

  return {
    /** Update the tracked peak from one frame of data and return the gain. */
    measure(waveform: Uint8Array): number {
      let peak = 0;
      for (let i = 0; i < waveform.length; i += 1) {
        const deviation = Math.abs(waveform[i] - 128);
        if (deviation > peak) peak = deviation;
      }
      trackedPeak = Math.max(peak, trackedPeak * peakDecay);
      if (trackedPeak < noiseFloor) return 1;
      return Math.min(maxGain, Math.max(1, targetAmplitude / trackedPeak));
    },
    /** Scale `input` around the 128 center into `output` (may be `input`). */
    apply(input: Uint8Array, output: Uint8Array, gain: number): void {
      for (let i = 0; i < input.length; i += 1) {
        const scaled = 128 + (input[i] - 128) * gain;
        output[i] = scaled < 0 ? 0 : scaled > 255 ? 255 : scaled;
      }
    },
    reset(): void {
      trackedPeak = 0;
    },
  };
}
