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

type MilkdropEnhancedEffectsPolicyArgs = {
  frameState: MilkdropFrameState;
  shaderQuality: 'low' | 'balanced' | 'high';
  qualityPresetId: string;
};

export function createMilkdropEnhancedEffectsPolicy() {
  let output: MilkdropFrameState | null = null;
  let outputMainWave: MilkdropFrameState['mainWave'] | null = null;
  let outputPost: MilkdropFrameState['post'] | null = null;
  let outputPostprocessingProfile: NonNullable<
    MilkdropFrameState['post']['postprocessingProfile']
  > | null = null;
  let outputGpuGeometry: MilkdropFrameState['gpuGeometry'] | null = null;
  let outputParticleField: NonNullable<
    MilkdropFrameState['gpuGeometry']['particleField']
  > | null = null;

  return ({
    frameState,
    shaderQuality,
    qualityPresetId,
  }: MilkdropEnhancedEffectsPolicyArgs) => {
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

    output ??= { ...frameState };
    Object.assign(output, frameState);
    output.warpField = frameState.warpField;
    output.interaction = frameState.interaction;

    if (isLowMotion) {
      outputMainWave ??= { ...frameState.mainWave };
      Object.assign(outputMainWave, frameState.mainWave, {
        thickness: Math.min(frameState.mainWave.thickness, 4),
      });
      output.mainWave = outputMainWave;
    } else {
      output.mainWave = frameState.mainWave;
    }

    const postprocessingProfile = frameState.post.postprocessingProfile;
    if (postprocessingProfile) {
      outputPost ??= { ...frameState.post };
      Object.assign(outputPost, frameState.post);
      outputPostprocessingProfile ??= { ...postprocessingProfile };
      Object.assign(outputPostprocessingProfile, postprocessingProfile, {
        enabled: false,
      });
      outputPost.postprocessingProfile = outputPostprocessingProfile;
      output.post = outputPost;
    } else {
      output.post = frameState.post;
    }

    const particleField = frameState.gpuGeometry.particleField;
    if (particleField) {
      outputGpuGeometry ??= { ...frameState.gpuGeometry };
      Object.assign(outputGpuGeometry, frameState.gpuGeometry);
      outputParticleField ??= { ...particleField };
      Object.assign(outputParticleField, particleField, { enabled: false });
      outputGpuGeometry.particleField = outputParticleField;
      output.gpuGeometry = outputGpuGeometry;
    } else {
      output.gpuGeometry = frameState.gpuGeometry;
    }

    return output;
  };
}

export function applyMilkdropEnhancedEffectsPolicy(
  args: MilkdropEnhancedEffectsPolicyArgs,
) {
  return createMilkdropEnhancedEffectsPolicy()(args);
}
