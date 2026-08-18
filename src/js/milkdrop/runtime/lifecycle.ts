import type {
  MilkdropBlendState,
  MilkdropFrameState,
  MilkdropPostVisual,
} from '../types.ts';

export function shouldAutoAdvancePreset({
  autoplay,
  catalogSize,
  now,
  lastPresetSwitchAt,
  blendDuration,
}: {
  autoplay: boolean;
  catalogSize: number;
  now: number;
  lastPresetSwitchAt: number;
  blendDuration: number;
}) {
  return (
    autoplay &&
    catalogSize > 1 &&
    now - lastPresetSwitchAt > Math.max(30000, blendDuration * 1000 + 6000)
  );
}

/**
 * Lead time before an autoplay advance in which the frame loop asks the
 * navigation controller to plan (pick + prefetch + precompile) the next
 * random preset, so the switch itself is a warm-cache apply.
 */
export const AUTO_ADVANCE_PREPARE_LEAD_MS = 8000;

export function shouldPrepareNextPreset(args: {
  autoplay: boolean;
  catalogSize: number;
  now: number;
  lastPresetSwitchAt: number;
  blendDuration: number;
}) {
  return shouldAutoAdvancePreset({
    ...args,
    now: args.now + AUTO_ADVANCE_PREPARE_LEAD_MS,
  });
}

// Per-frame blend alpha lives in runtime/transition-controller.ts now: the
// wall-clock recompute that used to live here jumped after hidden-tab pauses
// and kept running through gated frames. The per-frame gates (transition
// mode, shader quality, workload) moved to the frame loop's tick call.

export function buildRenderFrameState({
  frameState,
  shaderQuality,
  lowQualityPostOverride,
}: {
  frameState: MilkdropFrameState;
  shaderQuality: 'low' | 'balanced' | 'high';
  lowQualityPostOverride: Pick<
    MilkdropPostVisual,
    'shaderEnabled' | 'videoEchoEnabled'
  >;
}) {
  if (
    shaderQuality !== 'low' ||
    (!frameState.post.shaderEnabled && !frameState.post.videoEchoEnabled)
  ) {
    return frameState;
  }

  // Direct warp/comp programs are the preset's painter, not a decorative
  // post pass: stripping them leaves those presets as a black screen with a
  // bare wave line — "lighter graphics" must never mean "no graphics". Keep
  // the shader stage for them (the low step's feedback-resolution multiplier
  // still shrinks its pixel cost) and shed only the true extras.
  const shaderStageIsThePainter =
    (frameState.post.shaderPrograms?.warp ?? null) !== null ||
    (frameState.post.shaderPrograms?.comp ?? null) !== null;

  return {
    ...frameState,
    post: Object.assign({}, frameState.post, lowQualityPostOverride, {
      shaderEnabled: shaderStageIsThePainter,
      videoEchoEnabled: false,
      postprocessingProfile: frameState.post.postprocessingProfile
        ? {
            ...frameState.post.postprocessingProfile,
            enabled: false,
          }
        : frameState.post.postprocessingProfile,
    }),
    gpuGeometry: {
      ...frameState.gpuGeometry,
      particleField: frameState.gpuGeometry.particleField
        ? {
            ...frameState.gpuGeometry.particleField,
            enabled: false,
          }
        : frameState.gpuGeometry.particleField,
    },
  };
}
