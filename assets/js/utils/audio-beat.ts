export type AudioBandLevels = {
  bass: number;
  mid: number;
  treble: number;
};

export type BeatTrackerOptions = {
  threshold?: number;
  onsetThreshold?: number;
  minIntervalMs?: number;
  attackMs?: {
    bass?: number;
    mid?: number;
    treble?: number;
  };
  releaseMs?: {
    bass?: number;
    mid?: number;
    treble?: number;
  };
  beatDecay?: number;
  baselineMs?: number;
};

export type BeatTrackerUpdate = {
  smoothedBands: AudioBandLevels;
  beatIntensity: number;
  isBeat: boolean;
};

const DEFAULT_SMOOTHING = {
  bass: 32,
  mid: 48,
  treble: 28,
};

const DEFAULT_RELEASE = {
  bass: 180,
  mid: 220,
  treble: 140,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toSmoothingCoefficient(deltaMs: number, timeConstantMs: number) {
  if (timeConstantMs <= 0) {
    return 0;
  }
  return Math.exp(-Math.max(0, deltaMs) / timeConstantMs);
}

function applyEnvelope(
  current: number,
  next: number,
  deltaMs: number,
  attackMs: number,
  releaseMs: number,
) {
  const coefficient = toSmoothingCoefficient(
    deltaMs,
    next > current ? attackMs : releaseMs,
  );
  return current * coefficient + next * (1 - coefficient);
}

export function createBeatTracker(options: BeatTrackerOptions = {}) {
  const {
    threshold = 0.085,
    onsetThreshold = 0.018,
    minIntervalMs = 150,
    attackMs = DEFAULT_SMOOTHING,
    releaseMs = DEFAULT_RELEASE,
    beatDecay = 0.92,
    baselineMs = 360,
  } = options;

  let smoothedBands: AudioBandLevels = { bass: 0, mid: 0, treble: 0 };
  let beatIntensity = 0;
  let lastBeatTime = 0;
  let previousBands: AudioBandLevels = { bass: 0, mid: 0, treble: 0 };
  let previousWeightedEnergy = 0;
  let bassBaseline = 0;
  let energyBaseline = 0;

  const update = (
    {
      bands,
      weightedEnergy,
      deltaMs = 16.67,
    }: {
      bands: AudioBandLevels;
      weightedEnergy: number;
      deltaMs?: number;
    },
    timeMs: number,
  ): BeatTrackerUpdate => {
    smoothedBands = {
      bass: applyEnvelope(
        smoothedBands.bass,
        bands.bass,
        deltaMs,
        attackMs.bass ?? DEFAULT_SMOOTHING.bass,
        releaseMs.bass ?? DEFAULT_RELEASE.bass,
      ),
      mid: applyEnvelope(
        smoothedBands.mid,
        bands.mid,
        deltaMs,
        attackMs.mid ?? DEFAULT_SMOOTHING.mid,
        releaseMs.mid ?? DEFAULT_RELEASE.mid,
      ),
      treble: applyEnvelope(
        smoothedBands.treble,
        bands.treble,
        deltaMs,
        attackMs.treble ?? DEFAULT_SMOOTHING.treble,
        releaseMs.treble ?? DEFAULT_RELEASE.treble,
      ),
    };

    const baselineCoefficient = toSmoothingCoefficient(deltaMs, baselineMs);
    bassBaseline =
      bassBaseline * baselineCoefficient +
      smoothedBands.bass * (1 - baselineCoefficient);
    energyBaseline =
      energyBaseline * baselineCoefficient +
      weightedEnergy * (1 - baselineCoefficient);

    const bassRise = Math.max(0, bands.bass - previousBands.bass);
    const energyRise = Math.max(0, weightedEnergy - previousWeightedEnergy);
    const bassProminence = Math.max(0, smoothedBands.bass - bassBaseline);
    const energyProminence = Math.max(0, weightedEnergy - energyBaseline);
    const beatScore =
      bassProminence * 2.1 +
      bassRise * 3.6 +
      energyProminence * 1.15 +
      energyRise * 1.8;
    const isBeat =
      bassProminence > threshold &&
      bassRise > onsetThreshold &&
      beatScore > threshold * 2.2 &&
      timeMs - lastBeatTime > minIntervalMs;

    if (isBeat) {
      beatIntensity = clamp(0.35 + beatScore, 0, 1);
      lastBeatTime = timeMs;
    } else {
      beatIntensity *= beatDecay ** Math.max(0.25, deltaMs / 16.67);
    }

    previousBands = { ...bands };
    previousWeightedEnergy = weightedEnergy;

    return {
      smoothedBands,
      beatIntensity,
      isBeat,
    };
  };

  const reset = () => {
    smoothedBands = { bass: 0, mid: 0, treble: 0 };
    beatIntensity = 0;
    lastBeatTime = 0;
    previousBands = { bass: 0, mid: 0, treble: 0 };
    previousWeightedEnergy = 0;
    bassBaseline = 0;
    energyBaseline = 0;
  };

  return {
    update,
    reset,
    get smoothedBands() {
      return smoothedBands;
    },
    get beatIntensity() {
      return beatIntensity;
    },
  };
}
