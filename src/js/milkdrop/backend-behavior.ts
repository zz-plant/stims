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
    currentFrameBoost: 0.1,
    feedbackSoftness: 0.12,
    sceneResolutionScale: 1,
    feedbackResolutionScale: 1.25,
    samples: 0,
  },
  useHalfFloatFeedback: true,
  closeLinesManually: false,
  useLineLoopPrimitives: true,
  supportsShapeGradient: true,
  supportsShapeShaderFill: true,
  supportsFeedbackPass: true,
};

export const WEBGPU_MILKDROP_BACKEND_BEHAVIOR: MilkdropBackendBehavior = {
  feedbackProfile: {
    currentFrameBoost: 0.1,
    feedbackSoftness: 0.12,
    sceneResolutionScale: 1,
    feedbackResolutionScale: 1.25,
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
  options?: { mobile?: boolean },
): FeedbackBackendProfile {
  const behavior =
    backend === 'webgpu'
      ? WEBGPU_MILKDROP_BACKEND_BEHAVIOR
      : WEBGL_MILKDROP_BACKEND_BEHAVIOR;
  if (options?.mobile) {
    // Phones are fill-rate bound long before a feedback-alias bound matters:
    // drop the supersampling base to 1.0 so the feedback passes rasterize at
    // display resolution (adaptive throttling can still shrink them further).
    return {
      ...behavior.feedbackProfile,
      feedbackResolutionScale: 1.0,
    };
  }
  return behavior.feedbackProfile;
}
