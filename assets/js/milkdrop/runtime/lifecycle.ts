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
    now - lastPresetSwitchAt > Math.max(12000, blendDuration * 1000 + 6000)
  );
}

export function buildBlendStateForRender({
  transitionMode,
  shaderQuality,
  canBlendCurrentFrame,
  blendState,
  now,
  blendEndAtMs,
  blendDuration,
}: {
  transitionMode: 'blend' | 'cut';
  shaderQuality: 'low' | 'balanced' | 'high';
  canBlendCurrentFrame: boolean;
  blendState: MilkdropBlendState | null;
  now: number;
  blendEndAtMs: number;
  blendDuration: number;
}) {
  if (
    transitionMode !== 'blend' ||
    shaderQuality === 'low' ||
    !canBlendCurrentFrame ||
    !blendState ||
    now >= blendEndAtMs
  ) {
    return null;
  }

  return {
    ...blendState,
    alpha:
      1 -
      (now - (blendEndAtMs - blendDuration * 1000)) / (blendDuration * 1000),
  };
}

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

  return {
    ...frameState,
    post: Object.assign(lowQualityPostOverride, frameState.post, {
      shaderEnabled: false,
      videoEchoEnabled: false,
    }),
  };
}
