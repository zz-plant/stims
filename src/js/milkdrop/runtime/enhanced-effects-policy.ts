import { isMobileDevice } from '../../utils/device-detect.ts';
import { shouldUseCertificationCorpus } from '../catalog-query-override.ts';
import type { MilkdropFrameState } from '../types.ts';

function shouldAllowMilkdropEnhancedEffects({
  shaderQuality,
  qualityPresetId,
}: {
  shaderQuality: 'low' | 'balanced' | 'high';
  qualityPresetId: string;
}) {
  return (
    shaderQuality !== 'low' &&
    qualityPresetId !== 'performance' &&
    qualityPresetId !== 'low-motion' &&
    !isMobileDevice() &&
    !shouldUseCertificationCorpus()
  );
}

export function applyMilkdropEnhancedEffectsPolicy({
  frameState,
  shaderQuality,
  qualityPresetId,
}: {
  frameState: MilkdropFrameState;
  shaderQuality: 'low' | 'balanced' | 'high';
  qualityPresetId: string;
}) {
  if (
    shouldAllowMilkdropEnhancedEffects({
      shaderQuality,
      qualityPresetId,
    })
  ) {
    return frameState;
  }

  const particleField = frameState.gpuGeometry.particleField;
  const postprocessingProfile = frameState.post.postprocessingProfile;
  if (!particleField?.enabled && !postprocessingProfile?.enabled) {
    return frameState;
  }

  return {
    ...frameState,
    post: postprocessingProfile
      ? {
          ...frameState.post,
          postprocessingProfile: {
            ...postprocessingProfile,
            enabled: false,
          },
        }
      : frameState.post,
    gpuGeometry: particleField
      ? {
          ...frameState.gpuGeometry,
          particleField: {
            ...particleField,
            enabled: false,
          },
        }
      : frameState.gpuGeometry,
  };
}
