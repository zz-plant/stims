import type {
  MilkdropCapturedVideoReactiveState,
  MilkdropRuntimeSignals,
} from '../types.ts';

type EnvelopeConfig = {
  attackMs: number;
  releaseMs: number;
};

const DEFAULT_CAPTURED_VIDEO_REACTIVE_STATE: MilkdropCapturedVideoReactiveState =
  {
    bassPulse: 0,
    midMotion: 0,
    trebleShimmer: 0,
    energyWash: 0,
    beatAccent: 0,
    overlayAmount: 0.18,
    warpAmount: 0.03,
    mixAlphaFloor: 0.08,
    textureScaleX: 1.04,
    textureScaleY: 1.04,
    textureOffsetX: 0,
    textureOffsetY: 0,
    warpScaleX: 0.95,
    warpScaleY: 0.95,
    warpOffsetX: 0,
    warpOffsetY: 0,
    overlayWidthScale: 1,
    overlayHeightScale: 1,
    overlayDriftX: 0,
    overlayDriftY: 0,
    overlayRotation: 0,
    baseOpacity: 0.12,
    ghostOpacity: 0.1,
    ghostOffsetX: 0.015,
    ghostOffsetY: 0.006,
  };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothEnvelope(
  current: number,
  target: number,
  deltaMs: number,
  { attackMs, releaseMs }: EnvelopeConfig,
) {
  const timeConstantMs = target > current ? attackMs : releaseMs;
  const coefficient = Math.exp(-Math.max(0, deltaMs) / timeConstantMs);
  return current * coefficient + target * (1 - coefficient);
}

function resolveBandLevel(
  raw: number | undefined,
  accent: number | undefined,
  bias = 1,
) {
  return clamp(Math.max(raw ?? 0, (accent ?? 0) * bias), 0, 1.5);
}

export function createMilkdropCapturedVideoReactivityTracker() {
  let state = { ...DEFAULT_CAPTURED_VIDEO_REACTIVE_STATE };

  return {
    reset() {
      state = { ...DEFAULT_CAPTURED_VIDEO_REACTIVE_STATE };
    },
    update({
      signals,
    }: {
      signals: Pick<
        MilkdropRuntimeSignals,
        | 'time'
        | 'deltaMs'
        | 'bass'
        | 'bassAtt'
        | 'mid'
        | 'midsAtt'
        | 'midAtt'
        | 'treble'
        | 'trebleAtt'
        | 'weightedEnergy'
        | 'beatPulse'
      >;
    }): MilkdropCapturedVideoReactiveState {
      const time = signals.time ?? 0;
      const deltaMs = clamp(signals.deltaMs ?? 1000 / 60, 0, 80);
      const bass = resolveBandLevel(signals.bass, signals.bassAtt, 1.08);
      const mid = resolveBandLevel(
        signals.mid,
        Math.max(signals.midsAtt ?? 0, signals.midAtt ?? 0),
        1.04,
      );
      const treble = resolveBandLevel(signals.treble, signals.trebleAtt, 1.1);
      const energy = clamp(signals.weightedEnergy ?? 0, 0, 1.35);
      const beat = clamp(signals.beatPulse ?? 0, 0, 1.5);

      const bassPulse = smoothEnvelope(state.bassPulse, bass, deltaMs, {
        attackMs: 34,
        releaseMs: 190,
      });
      const midMotion = smoothEnvelope(state.midMotion, mid, deltaMs, {
        attackMs: 58,
        releaseMs: 240,
      });
      const trebleShimmer = smoothEnvelope(
        state.trebleShimmer,
        treble,
        deltaMs,
        {
          attackMs: 18,
          releaseMs: 84,
        },
      );
      const energyWash = smoothEnvelope(state.energyWash, energy, deltaMs, {
        attackMs: 90,
        releaseMs: 310,
      });
      const beatAccent = smoothEnvelope(state.beatAccent, beat, deltaMs, {
        attackMs: 16,
        releaseMs: 170,
      });

      state = {
        bassPulse,
        midMotion,
        trebleShimmer,
        energyWash,
        beatAccent,
        overlayAmount: clamp(
          0.16 + energyWash * 0.11 + bassPulse * 0.055 + beatAccent * 0.035,
          0.16,
          0.46,
        ),
        warpAmount: clamp(
          0.028 + bassPulse * 0.042 + trebleShimmer * 0.03 + beatAccent * 0.042,
          0.028,
          0.14,
        ),
        mixAlphaFloor: clamp(
          0.08 + energyWash * 0.05 + bassPulse * 0.025,
          0.08,
          0.2,
        ),
        textureScaleX: clamp(
          1.03 + bassPulse * 0.045 + beatAccent * 0.028,
          1.02,
          1.13,
        ),
        textureScaleY: clamp(
          1.03 + bassPulse * 0.036 + beatAccent * 0.024,
          1.02,
          1.12,
        ),
        textureOffsetX:
          Math.sin(time * 0.23) * (0.006 + midMotion * 0.013) +
          Math.cos(time * 0.61) * trebleShimmer * 0.003,
        textureOffsetY:
          Math.cos(time * 0.19) * (0.005 + midMotion * 0.011) +
          Math.sin(time * 0.53) * trebleShimmer * 0.0025,
        warpScaleX: clamp(
          0.96 - bassPulse * 0.04 + trebleShimmer * 0.01,
          0.9,
          0.99,
        ),
        warpScaleY: clamp(
          0.96 - bassPulse * 0.036 + trebleShimmer * 0.012,
          0.9,
          0.99,
        ),
        warpOffsetX:
          Math.sin(time * 0.33) * (0.014 + midMotion * 0.016) +
          Math.cos(time * 0.77) * trebleShimmer * 0.009,
        warpOffsetY:
          Math.cos(time * 0.27) * (0.012 + midMotion * 0.014) +
          Math.sin(time * 0.73) * trebleShimmer * 0.008,
        overlayWidthScale: clamp(
          1 + bassPulse * 0.055 + beatAccent * 0.02,
          1,
          1.12,
        ),
        overlayHeightScale: clamp(
          1 + bassPulse * 0.038 + beatAccent * 0.016,
          1,
          1.1,
        ),
        overlayDriftX:
          Math.sin(time * 0.21) * (0.012 + midMotion * 0.042) +
          Math.cos(time * 0.49) * trebleShimmer * 0.008,
        overlayDriftY:
          Math.cos(time * 0.18) * (0.01 + midMotion * 0.028) +
          Math.sin(time * 0.37) * bassPulse * 0.009,
        overlayRotation:
          Math.sin(time * 0.31) * (0.012 + midMotion * 0.018) +
          beatAccent * 0.012,
        baseOpacity: clamp(
          0.12 + energyWash * 0.12 + bassPulse * 0.045,
          0.12,
          0.34,
        ),
        ghostOpacity: clamp(
          0.1 + trebleShimmer * 0.11 + beatAccent * 0.045,
          0.1,
          0.29,
        ),
        ghostOffsetX: clamp(
          0.015 + trebleShimmer * 0.023 + beatAccent * 0.014,
          0.015,
          0.06,
        ),
        ghostOffsetY: clamp(0.006 + midMotion * 0.01, 0.006, 0.026),
      };

      return state;
    },
  };
}
