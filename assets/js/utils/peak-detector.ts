import type { AudioAnalyser } from 'three';
import { getAverageFrequency, getFrequencyData } from './audio-handler';

export interface PeakDetectorOptions {
  analyser?: AudioAnalyser;
  /** Custom provider for FFT data; use when you already have a buffer handy. */
  getData?: () => Uint8Array;
  /** How much louder than the baseline the signal must be to trigger a peak. */
  sensitivity?: number;
  /** Smoothing factor for the rolling baseline. Closer to 1 = slower changes. */
  decay?: number;
  /** Milliseconds to wait before allowing another peak event. */
  cooldownMs?: number;
  /** Fired once when a new peak is detected. */
  onPeak?: (level: number, threshold: number) => void;
  /** Fired after a peak falls back to the baseline. */
  onRelease?: (level: number, threshold: number) => void;
}

export interface PeakDetector {
  /**
   * Sample the data source and update peak state. Optionally provide your own
   * data buffer to avoid an extra allocation.
   */
  update(data?: Uint8Array): PeakState;
  reset(): void;
  readonly isPeaking: boolean;
}

export interface PeakState {
  level: number;
  threshold: number;
  baseline: number;
  isPeaking: boolean;
}

function resolveDataSource({
  analyser,
  getData,
}: Pick<PeakDetectorOptions, 'analyser' | 'getData'>):
  | (() => Uint8Array)
  | null {
  if (typeof getData === 'function') {
    return getData;
  }

  if (analyser) {
    return () => getFrequencyData(analyser);
  }

  return null;
}

const DEFAULT_SENSITIVITY = 0.35;
const DEFAULT_DECAY = 0.9;
const DEFAULT_COOLDOWN_MS = 150;

export const createPeakDetector = (
  options: PeakDetectorOptions
): PeakDetector => {
  const {
    sensitivity = DEFAULT_SENSITIVITY,
    decay = DEFAULT_DECAY,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    onPeak,
    onRelease,
  } = options;

  const dataSource = resolveDataSource(options);
  if (!dataSource) {
    throw new Error('Peak detector requires an analyser or getData provider.');
  }

  let baseline = 0;
  let isPeaking = false;
  let lastTrigger = 0;

  const measureLevel = (data: Uint8Array) =>
    data.length === 0 ? 0 : getAverageFrequency(data) / 255;

  const update = (data?: Uint8Array): PeakState => {
    const buffer = data ?? dataSource();
    const level = measureLevel(buffer);

    baseline = baseline === 0 ? level : baseline * decay + level * (1 - decay);
    const threshold = baseline * (1 + sensitivity);
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (!isPeaking && level > threshold && now - lastTrigger >= cooldownMs) {
      isPeaking = true;
      lastTrigger = now;
      onPeak?.(level, threshold);
    } else if (
      isPeaking &&
      level <= baseline &&
      now - lastTrigger >= cooldownMs
    ) {
      isPeaking = false;
      onRelease?.(level, threshold);
    }

    return { level, threshold, baseline, isPeaking };
  };

  const reset = () => {
    baseline = 0;
    isPeaking = false;
    lastTrigger = 0;
  };

  return {
    update,
    reset,
    get isPeaking() {
      return isPeaking;
    },
  };
};

export default createPeakDetector;

declare global {
  interface Window {
    createPeakDetector?: typeof createPeakDetector;
  }
}

if (typeof window !== 'undefined' && !window.createPeakDetector) {
  window.createPeakDetector = createPeakDetector;
}
