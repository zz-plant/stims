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

  const bass = averageRange(data, 0, ratios.bass) / 255;
  const mid = averageRange(data, ratios.bass, ratios.mid) / 255;
  const treble = averageRange(data, ratios.mid, 1) / 255;

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
  { decay = 0.96, floor = 0.05 }: { decay?: number; floor?: number } = {},
): number {
  return Math.max(currentPeak * decay, weightedEnergy, floor);
}

function averageRange(
  dataArray: Uint8Array,
  startRatio: number,
  endRatio: number,
) {
  if (!dataArray.length) return 0;
  const startIndex = Math.floor(dataArray.length * startRatio);
  const endIndex = Math.max(
    startIndex + 1,
    Math.floor(dataArray.length * endRatio),
  );
  let sum = 0;
  const count = endIndex - startIndex;
  for (let i = startIndex; i < endIndex; i += 1) {
    sum += dataArray[i];
  }
  return sum / count;
}
