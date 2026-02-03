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

const DEFAULT_RATIOS: BandRatios = { bass: 0.12, mid: 0.5 };
const DEFAULT_WEIGHTS: BandWeights = { bass: 0.6, mid: 0.25, treble: 0.15 };

export function getBandLevels({
  analyser,
  data,
  ratios = DEFAULT_RATIOS,
}: {
  analyser?: { getMultiBandEnergy?: () => BandLevels | null } | null;
  data: Uint8Array;
  ratios?: BandRatios;
}): BandLevels {
  const fromAnalyser = analyser?.getMultiBandEnergy?.();
  if (fromAnalyser) return fromAnalyser;

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
