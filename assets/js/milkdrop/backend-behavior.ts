export type FeedbackBackendProfile = {
  currentFrameBoost: number;
  feedbackSoftness: number;
  sceneResolutionScale: number;
  feedbackResolutionScale: number;
  samples: number;
};

export type MilkdropBackendBehavior = {
  feedbackProfile: FeedbackBackendProfile;
  useHalfFloatFeedback: boolean;
  closeLinesManually: boolean;
  useLineLoopPrimitives: boolean;
  supportsShapeGradient: boolean;
  supportsShapeShaderFill: boolean;
  supportsFeedbackPass: boolean;
};

export const WEBGL_MILKDROP_BACKEND_BEHAVIOR: MilkdropBackendBehavior = {
  feedbackProfile: {
    currentFrameBoost: 0,
    feedbackSoftness: 0,
    sceneResolutionScale: 1,
    feedbackResolutionScale: 1,
    samples: 0,
  },
  useHalfFloatFeedback: false,
  closeLinesManually: false,
  useLineLoopPrimitives: true,
  supportsShapeGradient: true,
  supportsShapeShaderFill: true,
  supportsFeedbackPass: true,
};

export const WEBGPU_MILKDROP_BACKEND_BEHAVIOR: MilkdropBackendBehavior = {
  feedbackProfile: {
    currentFrameBoost: 0.1,
    feedbackSoftness: 0.65,
    sceneResolutionScale: 1,
    feedbackResolutionScale: 1,
    samples: 0,
  },
  useHalfFloatFeedback: true,
  closeLinesManually: true,
  useLineLoopPrimitives: false,
  supportsShapeGradient: true,
  supportsShapeShaderFill: true,
  supportsFeedbackPass: true,
};

export function getFeedbackBackendProfile(
  backend: 'webgl' | 'webgpu',
): FeedbackBackendProfile {
  return backend === 'webgpu'
    ? WEBGPU_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile
    : WEBGL_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile;
}
