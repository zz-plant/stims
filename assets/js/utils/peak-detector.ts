export type PeakDetectorOptions = {
  /**
   * Multiplier applied to the smoothed signal to determine a transient peak.
   */
  sensitivity?: number;
  /**
   * Minimum time (ms) between peak callbacks.
   */
  cooldownMs?: number;
  /**
   * How quickly the smoothed baseline follows the incoming signal.
   */
  smoothing?: number;
  onPeak?: (level: number) => void;
};

/**
 * Lightweight peak detector for FFT data. Keeps a smoothed baseline of the
 * signal and triggers a callback when the incoming level exceeds the baseline
 * by the configured sensitivity factor. Cooldown prevents rapid re-triggers.
 */
export class PeakDetector {
  private smoothed = 0;
  private lastPeak = 0;
  private sensitivity: number;
  private readonly cooldownMs: number;
  private readonly smoothing: number;
  private readonly onPeak?: (level: number) => void;

  constructor(options: PeakDetectorOptions = {}) {
    const {
      sensitivity = 1.4,
      cooldownMs = 180,
      smoothing = 0.1,
      onPeak,
    } = options;
    this.sensitivity = sensitivity;
    this.cooldownMs = cooldownMs;
    this.smoothing = smoothing;
    this.onPeak = onPeak;
  }

  update(level: number, now: number = performance.now()): boolean {
    if (Number.isNaN(level)) return false;
    this.smoothed += (level - this.smoothed) * this.smoothing;
    const threshold = this.smoothed * this.sensitivity;
    if (level > threshold && now - this.lastPeak > this.cooldownMs) {
      this.lastPeak = now;
      this.onPeak?.(level);
      return true;
    }
    return false;
  }

  setSensitivity(value: number) {
    this.smoothed = 0;
    this.lastPeak = 0;
    this.sensitivity = value;
  }
}

export function createPeakDetector(options: PeakDetectorOptions = {}) {
  return new PeakDetector(options);
}
