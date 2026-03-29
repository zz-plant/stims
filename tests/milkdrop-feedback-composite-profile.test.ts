import { expect, test } from 'bun:test';
import {
  clampMilkdropCurrentFrameBoost,
  getMilkdropFeedbackBlurBlendAmount,
  getMilkdropFeedbackBlurSampleOffsetMultiplier,
  MILKDROP_FEEDBACK_BLUR_BLEND_CAP,
  MILKDROP_FEEDBACK_BLUR_OFFSET_BASE,
  MILKDROP_FEEDBACK_CURRENT_FRAME_BOOST_CAP,
} from '../assets/js/milkdrop/feedback-composite-profile.ts';

test('uses the shared milkdrop feedback blur profile across backends', () => {
  expect(getMilkdropFeedbackBlurSampleOffsetMultiplier(0)).toBeCloseTo(
    MILKDROP_FEEDBACK_BLUR_OFFSET_BASE,
    6,
  );
  expect(getMilkdropFeedbackBlurSampleOffsetMultiplier(0.65)).toBeCloseTo(
    1.075,
    6,
  );
  expect(getMilkdropFeedbackBlurBlendAmount(0.65)).toBeCloseTo(0.2925, 6);
  expect(getMilkdropFeedbackBlurBlendAmount(10)).toBe(
    MILKDROP_FEEDBACK_BLUR_BLEND_CAP,
  );
});

test('clamps current-frame boost to the shared parity cap', () => {
  expect(clampMilkdropCurrentFrameBoost(-1)).toBe(0);
  expect(clampMilkdropCurrentFrameBoost(0.2)).toBeCloseTo(0.2, 6);
  expect(clampMilkdropCurrentFrameBoost(1)).toBe(
    MILKDROP_FEEDBACK_CURRENT_FRAME_BOOST_CAP,
  );
});
