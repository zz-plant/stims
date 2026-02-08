export type AudioBandLevels = {
  bass: number;
  mid: number;
  treble: number;
};

export type BeatTrackerOptions = {
  threshold?: number;
  minIntervalMs?: number;
  smoothing?: {
    bass?: number;
    mid?: number;
    treble?: number;
  };
  beatDecay?: number;
};

export type BeatTrackerUpdate = {
  smoothedBands: AudioBandLevels;
  beatIntensity: number;
  isBeat: boolean;
};

const DEFAULT_SMOOTHING = {
  bass: 0.85,
  mid: 0.9,
  treble: 0.92,
};

export function createBeatTracker(options: BeatTrackerOptions = {}) {
  const {
    threshold = 0.45,
    minIntervalMs = 150,
    smoothing = DEFAULT_SMOOTHING,
    beatDecay = 0.92,
  } = options;

  let smoothedBands: AudioBandLevels = { bass: 0, mid: 0, treble: 0 };
  let beatIntensity = 0;
  let lastBeatTime = 0;

  const update = (
    bands: AudioBandLevels,
    timeMs: number,
  ): BeatTrackerUpdate => {
    smoothedBands = {
      bass:
        smoothedBands.bass * (smoothing.bass ?? DEFAULT_SMOOTHING.bass) +
        bands.bass * (1 - (smoothing.bass ?? DEFAULT_SMOOTHING.bass)),
      mid:
        smoothedBands.mid * (smoothing.mid ?? DEFAULT_SMOOTHING.mid) +
        bands.mid * (1 - (smoothing.mid ?? DEFAULT_SMOOTHING.mid)),
      treble:
        smoothedBands.treble * (smoothing.treble ?? DEFAULT_SMOOTHING.treble) +
        bands.treble * (1 - (smoothing.treble ?? DEFAULT_SMOOTHING.treble)),
    };

    const isBeat =
      smoothedBands.bass > threshold && timeMs - lastBeatTime > minIntervalMs;

    if (isBeat) {
      beatIntensity = 1;
      lastBeatTime = timeMs;
    } else {
      beatIntensity *= beatDecay;
    }

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
