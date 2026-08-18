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

/**
 * Knobs for the present-pass preset-transition dissolve. Both the WebGL
 * fragment shader (feedback-manager-shared.ts) and the WebGPU TSL node
 * (feedback-manager-webgpu-tsl.ts) build their pattern from these values, so
 * tuning here keeps the two backends visually identical.
 *
 * The pattern is two octaves of value noise sampled in aspect-corrected UV
 * space (so patches are round on any screen). Each pixel flips from the saved
 * frame to the live preset when the eased transition alpha crosses that
 * pixel's pattern value, feathered over `band`.
 */
export const MILKDROP_BLEND_DISSOLVE = {
  /** Coarse-octave frequency: roughly how many patch cells span the screen
   * height. Lower reads as a broad plasma sweep; higher as confetti. */
  coarseScale: 3.5,
  /** Fine-octave frequency; breaks up the coarse cells' straight edges.
   * Keep a non-integer ratio to coarseScale so the grids never align. */
  fineScale: 8.5,
  /** Share of the pattern taken by the coarse octave (fine gets the rest).
   * Higher favors large connected regions over speckle. */
  coarseWeight: 0.68,
  /** UV offset decorrelating the fine octave from the coarse one. */
  fineOffset: 31.7,
  /** Half-width of the feathered flip edge, in pattern units. Wider is
   * softer and approaches the old uniform crossfade; narrower is a hard
   * wipe that can shimmer on high-contrast presets. */
  band: 0.22,
} as const;
