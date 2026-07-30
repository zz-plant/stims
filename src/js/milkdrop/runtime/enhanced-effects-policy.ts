import { getDevicePerformanceProfile } from '../../core/device-profile.ts';
import { isMobileDevice } from '../../utils/browser/device-detect.ts';
import { shouldUseCertificationCorpus } from '../catalog-query-override.ts';
import type { MilkdropFrameState } from '../types.ts';

function shouldAllowMilkdropEnhancedEffects({
  shaderQuality,
  qualityPresetId,
}: {
  shaderQuality: 'low' | 'balanced' | 'high';
  qualityPresetId: string;
}) {
  if (shouldUseCertificationCorpus()) {
    return false;
  }

  if (
    shaderQuality === 'low' ||
    qualityPresetId === 'performance' ||
    qualityPresetId === 'low-motion'
  ) {
    return false;
  }

  if (isMobileDevice()) {
    return !getDevicePerformanceProfile().lowPower;
  }

  return true;
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
  const isLowMotion = qualityPresetId === 'low-motion';

  if (
    shouldAllowMilkdropEnhancedEffects({
      shaderQuality,
      qualityPresetId,
    }) &&
    !isLowMotion
  ) {
    return frameState;
  }

  const particleField = frameState.gpuGeometry.particleField;
  const postprocessingProfile = frameState.post.postprocessingProfile;

  return {
    ...frameState,
    mainWave: isLowMotion
      ? {
          ...frameState.mainWave,
          thickness: Math.min(frameState.mainWave.thickness, 4),
        }
      : frameState.mainWave,
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
