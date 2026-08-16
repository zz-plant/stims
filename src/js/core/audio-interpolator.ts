/**
 * Hermite Cubic Spline Audio Reactivity Interpolator.
 *
 * Smoothly interpolates and extrapolates audio energy values (bass, mid, treble, RMS)
 * between discrete AudioWorklet FFT packets.
 *
 * Eliminates audio stepping and discrete staircasing on high-refresh displays (120Hz, 144Hz, 240Hz),
 * ensuring continuous derivative-continuous (C1) energy curves.
 */

export type AudioEnergySnapshot = {
  bass: number;
  mid: number;
  treble: number;
  rms?: number;
};

type Keyframe = {
  timeMs: number;
  bass: number;
  mid: number;
  treble: number;
  rms: number;
  velocityBass: number;
  velocityMid: number;
  velocityTreble: number;
  velocityRms: number;
};

export type AudioReactivityInterpolator = {
  /** Feed a new discrete FFT audio packet with the current timestamp. */
  pushSample: (sample: AudioEnergySnapshot, timeMs: number) => void;

  /** Sample the continuous audio energy curve at any arbitrary render time. */
  sample: (timeMs: number) => AudioEnergySnapshot;

  /** Reset internal history (e.g. on song change or track stop). */
  reset: () => void;
};

/**
 * Standard cubic Hermite spline interpolation formula:
 * p(t) = h00(s)*p0 + h10(s)*(t1-t0)*m0 + h01(s)*p1 + h11(s)*(t1-t0)*m1
 * where s = (t - t0) / (t1 - t0)
 */
function hermiteInterpolate(
  p0: number,
  m0: number,
  p1: number,
  m1: number,
  tDelta: number,
  s: number,
): number {
  const s2 = s * s;
  const s3 = s2 * s;

  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;

  const interpolated =
    h00 * p0 + h10 * tDelta * m0 + h01 * p1 + h11 * tDelta * m1;
  return Math.max(0, interpolated);
}

export function createAudioReactivityInterpolator(): AudioReactivityInterpolator {
  let prevKeyframe: Keyframe | null = null;
  let currentKeyframe: Keyframe | null = null;

  return {
    pushSample(sample: AudioEnergySnapshot, timeMs: number): void {
      const rms = sample.rms ?? (sample.bass + sample.mid + sample.treble) / 3;

      if (!currentKeyframe) {
        currentKeyframe = {
          timeMs,
          bass: sample.bass,
          mid: sample.mid,
          treble: sample.treble,
          rms,
          velocityBass: 0,
          velocityMid: 0,
          velocityTreble: 0,
          velocityRms: 0,
        };
        return;
      }

      const dt = Math.max(0.001, (timeMs - currentKeyframe.timeMs) / 1000); // in seconds

      const velocityBass = (sample.bass - currentKeyframe.bass) / dt;
      const velocityMid = (sample.mid - currentKeyframe.mid) / dt;
      const velocityTreble = (sample.treble - currentKeyframe.treble) / dt;
      const velocityRms = (rms - currentKeyframe.rms) / dt;

      prevKeyframe = currentKeyframe;
      currentKeyframe = {
        timeMs,
        bass: sample.bass,
        mid: sample.mid,
        treble: sample.treble,
        rms,
        velocityBass,
        velocityMid,
        velocityTreble,
        velocityRms,
      };
    },

    sample(timeMs: number): AudioEnergySnapshot {
      if (!currentKeyframe) {
        return { bass: 0, mid: 0, treble: 0, rms: 0 };
      }

      // If we only have 1 sample or time is at/ahead of current keyframe with no prev
      if (!prevKeyframe) {
        return {
          bass: currentKeyframe.bass,
          mid: currentKeyframe.mid,
          treble: currentKeyframe.treble,
          rms: currentKeyframe.rms,
        };
      }

      const t0 = prevKeyframe.timeMs;
      const t1 = currentKeyframe.timeMs;
      const spanMs = t1 - t0;

      if (spanMs <= 0.001) {
        return {
          bass: currentKeyframe.bass,
          mid: currentKeyframe.mid,
          treble: currentKeyframe.treble,
          rms: currentKeyframe.rms,
        };
      }

      const dtSec = spanMs / 1000;
      const elapsed = timeMs - t0;
      const s = Math.max(0, Math.min(1.25, elapsed / spanMs)); // Allow slight forward extrapolation

      return {
        bass: hermiteInterpolate(
          prevKeyframe.bass,
          prevKeyframe.velocityBass,
          currentKeyframe.bass,
          currentKeyframe.velocityBass,
          dtSec,
          s,
        ),
        mid: hermiteInterpolate(
          prevKeyframe.mid,
          prevKeyframe.velocityMid,
          currentKeyframe.mid,
          currentKeyframe.velocityMid,
          dtSec,
          s,
        ),
        treble: hermiteInterpolate(
          prevKeyframe.treble,
          prevKeyframe.velocityTreble,
          currentKeyframe.treble,
          currentKeyframe.velocityTreble,
          dtSec,
          s,
        ),
        rms: hermiteInterpolate(
          prevKeyframe.rms,
          prevKeyframe.velocityRms,
          currentKeyframe.rms,
          currentKeyframe.velocityRms,
          dtSec,
          s,
        ),
      };
    },

    reset(): void {
      prevKeyframe = null;
      currentKeyframe = null;
    },
  };
}
