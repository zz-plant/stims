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
  midThreshold?: number;
  trebleThreshold?: number;
};

export type BeatTrackerUpdate = {
  smoothedBands: AudioBandLevels;
  beatIntensity: number;
  isBeat: boolean;
  isTransient: boolean;
  spectralFlux: number;
  bandFlux: number;
  beatBass: boolean;
  beatMid: boolean;
  beatTreble: boolean;
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
    midThreshold = 0.06,
    trebleThreshold = 0.04,
  } = options;

  let smoothedBands: AudioBandLevels = { bass: 0, mid: 0, treble: 0 };
  let beatIntensity = 0;
  let bassBeatIntensity = 0;
  let midBeatIntensity = 0;
  let trebleBeatIntensity = 0;
  let lastBassBeatTime = 0;
  let lastMidBeatTime = 0;
  let lastTrebleBeatTime = 0;
  let previousBands: AudioBandLevels = { bass: 0, mid: 0, treble: 0 };
  let previousWeightedEnergy = 0;
  let bassBaseline = 0;
  let midBaseline = 0;
  let trebleBaseline = 0;
  let energyBaseline = 0;
  let _previousSpectrum: Float32Array | null = null;
  let spectralFlux = 0;
  let bandFlux = 0;

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

    if (!_previousSpectrum) {
      _previousSpectrum = new Float32Array(3);
      _previousSpectrum[0] = bands.bass;
      _previousSpectrum[1] = bands.mid;
      _previousSpectrum[2] = bands.treble;
    }

    let fluxSum = 0;
    const bandValues = [bands.bass, bands.mid, bands.treble];
    for (let i = 0; i < 3; i += 1) {
      fluxSum += Math.max(
        0,
        (bandValues[i] ?? 0) - (_previousSpectrum[i] ?? 0),
      );
    }
    spectralFlux = fluxSum / 3;
    _previousSpectrum[0] = bands.bass;
    _previousSpectrum[1] = bands.mid;
    _previousSpectrum[2] = bands.treble;

    const baselineCoefficient = toSmoothingCoefficient(deltaMs, baselineMs);
    bassBaseline =
      bassBaseline * baselineCoefficient +
      smoothedBands.bass * (1 - baselineCoefficient);
    midBaseline =
      midBaseline * baselineCoefficient +
      smoothedBands.mid * (1 - baselineCoefficient);
    trebleBaseline =
      trebleBaseline * baselineCoefficient +
      smoothedBands.treble * (1 - baselineCoefficient);
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

    const midRise = Math.max(0, bands.mid - previousBands.mid);
    const midProminence = Math.max(0, smoothedBands.mid - midBaseline);
    const midEnergyWeight = midProminence * 1.6 + midRise * 2.8;

    const trebleRise = Math.max(0, bands.treble - previousBands.treble);
    const trebleProminence = Math.max(0, smoothedBands.treble - trebleBaseline);
    const trebleEnergyWeight = trebleProminence * 1.3 + trebleRise * 2.2;

    const fluxRise = bassRise + energyRise;
    const isTransient = fluxRise > 0.15 && weightedEnergy > 0.25;

    const minIntervalFrames = minIntervalMs;
    const beatBass =
      bassProminence > threshold &&
      bassRise > onsetThreshold &&
      beatScore > threshold * 2.2 &&
      timeMs - lastBassBeatTime > minIntervalFrames;

    const beatMid =
      midProminence > midThreshold &&
      midRise > onsetThreshold * 0.7 &&
      midEnergyWeight > midThreshold * 2.0 &&
      timeMs - lastMidBeatTime > minIntervalFrames;

    const beatTreble =
      trebleProminence > trebleThreshold &&
      trebleRise > onsetThreshold * 0.5 &&
      trebleEnergyWeight > trebleThreshold * 1.8 &&
      timeMs - lastTrebleBeatTime > minIntervalFrames;

    if (beatBass) {
      bassBeatIntensity = clamp(0.35 + beatScore, 0, 1);
      lastBassBeatTime = timeMs;
    } else {
      bassBeatIntensity *= beatDecay ** Math.max(0.25, deltaMs / 16.67);
    }

    if (beatMid) {
      midBeatIntensity = clamp(0.28 + midEnergyWeight, 0, 1);
      lastMidBeatTime = timeMs;
    } else {
      midBeatIntensity *= beatDecay ** Math.max(0.25, deltaMs / 16.67);
    }

    if (beatTreble) {
      trebleBeatIntensity = clamp(0.22 + trebleEnergyWeight, 0, 1);
      lastTrebleBeatTime = timeMs;
    } else {
      trebleBeatIntensity *= beatDecay ** Math.max(0.25, deltaMs / 16.67);
    }

    const isBeat = beatBass || beatMid || beatTreble;
    beatIntensity = Math.max(
      bassBeatIntensity,
      midBeatIntensity,
      trebleBeatIntensity,
    );

    previousBands.bass = bands.bass;
    previousBands.mid = bands.mid;
    previousBands.treble = bands.treble;
    previousWeightedEnergy = weightedEnergy;
    bandFlux = bassRise + energyRise + midRise;

    return {
      smoothedBands,
      beatIntensity,
      isBeat,
      isTransient,
      spectralFlux,
      bandFlux,
      beatBass,
      beatMid,
      beatTreble,
    };
  };

  const reset = () => {
    smoothedBands = { bass: 0, mid: 0, treble: 0 };
    beatIntensity = 0;
    bassBeatIntensity = 0;
    midBeatIntensity = 0;
    trebleBeatIntensity = 0;
    lastBassBeatTime = 0;
    lastMidBeatTime = 0;
    lastTrebleBeatTime = 0;
    previousBands = { bass: 0, mid: 0, treble: 0 };
    previousWeightedEnergy = 0;
    bassBaseline = 0;
    midBaseline = 0;
    trebleBaseline = 0;
    energyBaseline = 0;
    _previousSpectrum = null;
    spectralFlux = 0;
    bandFlux = 0;
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
