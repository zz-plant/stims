export const MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD = 0.01;
export const MILKDROP_FEEDBACK_BLUR_OFFSET_BASE = 0.75;
export const MILKDROP_FEEDBACK_BLUR_OFFSET_SCALE = 0.5;
export const MILKDROP_FEEDBACK_BLUR_BLEND_SCALE = 0.45;
export const MILKDROP_FEEDBACK_BLUR_BLEND_CAP = 0.5;
export const MILKDROP_FEEDBACK_CURRENT_FRAME_BOOST_CAP = 0.3;

export function getMilkdropFeedbackBlurSampleOffsetMultiplier(
  feedbackSoftness: number,
) {
  return (
    MILKDROP_FEEDBACK_BLUR_OFFSET_BASE +
    feedbackSoftness * MILKDROP_FEEDBACK_BLUR_OFFSET_SCALE
  );
}

export function getMilkdropFeedbackBlurBlendAmount(feedbackSoftness: number) {
  return Math.min(
    MILKDROP_FEEDBACK_BLUR_BLEND_CAP,
    Math.max(0, feedbackSoftness * MILKDROP_FEEDBACK_BLUR_BLEND_SCALE),
  );
}

export function clampMilkdropCurrentFrameBoost(currentFrameBoost: number) {
  return Math.min(
    MILKDROP_FEEDBACK_CURRENT_FRAME_BOOST_CAP,
    Math.max(0, currentFrameBoost),
  );
}
