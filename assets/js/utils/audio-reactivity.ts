import { getBandAverage } from './audio-bands';

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
  bass: { minHz: 24, maxHz: 320 },
  mid: { minHz: 320, maxHz: 2800 },
  treble: { minHz: 2800, maxHz: 12000 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveBandIndexes(
  dataLength: number,
  sampleRate: number,
  range: FrequencyBandRange,
) {
  if (dataLength <= 0 || sampleRate <= 0) {
    return { start: 0, end: 0 };
  }

  const fftSize = dataLength * 2;
  const resolutionHz = sampleRate / fftSize;
  const nyquistHz = sampleRate / 2;
  const minHz = clamp(range.minHz, 0, nyquistHz);
  const maxHz = clamp(Math.max(minHz, range.maxHz), 0, nyquistHz);
  const start = clamp(Math.floor(minHz / resolutionHz), 0, dataLength - 1);
  const end = clamp(Math.ceil(maxHz / resolutionHz), start + 1, dataLength);

  return { start, end };
}

function getBandAverageForRange(
  data: Uint8Array,
  sampleRate: number,
  range: FrequencyBandRange,
  band: keyof FrequencyBandRanges,
): number {
  if (data.length === 0) return 0;

  const { start, end } = resolveBandIndexes(data.length, sampleRate, range);
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
): BandLevels {
  if (data.length === 0) {
    return { bass: 0, mid: 0, treble: 0 };
  }

  const bass =
    getBandAverageForRange(data, sampleRate, bandRanges.bass, 'bass') / 255;
  const mid =
    getBandAverageForRange(data, sampleRate, bandRanges.mid, 'mid') / 255;
  const treble =
    getBandAverageForRange(data, sampleRate, bandRanges.treble, 'treble') / 255;

  return { bass, mid, treble };
}

export function getBandLevels({
  analyser,
  data,
  sampleRate,
  ratios = DEFAULT_RATIOS,
  bandRanges = DEFAULT_FREQUENCY_BAND_RANGES,
}: {
  analyser?: { getMultiBandEnergy?: () => BandLevels | null } | null;
  data: Uint8Array;
  sampleRate?: number;
  ratios?: BandRatios;
  bandRanges?: FrequencyBandRanges;
}): BandLevels {
  const fromAnalyser = analyser?.getMultiBandEnergy?.();
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
