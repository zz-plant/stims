import { describe, expect, test } from 'bun:test';
import {
  WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
} from '../../src/js/milkdrop/backend-behavior.ts';
import { MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD } from '../../src/js/milkdrop/feedback-composite-profile.ts';

type RenderPassCost = {
  name: string;
  resolutionScale: number;
  textureSamplesPerPixel: number;
  description: string;
};

type FrameCost = {
  passes: RenderPassCost[];
  totalSamplesPerPixelPixel: number;
  totalPasses: number;
};

const BLUR_RADII = [2, 4, 8];

function analyzeBlurPasses(
  feedbackSoftness: number,
  feedbackResolutionScale: number,
  separable: boolean,
  blurEnabled: boolean,
): RenderPassCost[] {
  if (
    !blurEnabled ||
    feedbackSoftness <= MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD
  ) {
    return [];
  }

  if (separable) {
    const passes: RenderPassCost[] = [];
    for (let i = 0; i < BLUR_RADII.length; i++) {
      const r = BLUR_RADII[i];
      const resScale =
        i === 0
          ? feedbackResolutionScale
          : i === 1
            ? feedbackResolutionScale * 0.5
            : feedbackResolutionScale * 0.25;
      const samplesPerPass = 2 * r + 1;
      passes.push({
        name: `blur-h-${i}`,
        resolutionScale: resScale,
        textureSamplesPerPixel: samplesPerPass,
        description: `horizontal blur r=${r}`,
      });
      passes.push({
        name: `blur-v-${i}`,
        resolutionScale: resScale,
        textureSamplesPerPixel: samplesPerPass,
        description: `vertical blur r=${r}`,
      });
    }
    return passes;
  }

  const passes: RenderPassCost[] = [];
  for (let i = 0; i < BLUR_RADII.length; i++) {
    const r = BLUR_RADII[i];
    const resScale =
      i === 0
        ? feedbackResolutionScale
        : i === 1
          ? feedbackResolutionScale * 0.5
          : feedbackResolutionScale * 0.25;
    const samplesPerPass = (2 * r + 1) ** 2;
    passes.push({
      name: `blur-${i}`,
      resolutionScale: resScale,
      textureSamplesPerPixel: samplesPerPass,
      description: `box blur r=${r}`,
    });
  }
  return passes;
}

function analyzeFrameCost(
  backend: 'webgl' | 'webgpu',
  options: {
    separableBlur?: boolean;
    blurEnabled?: boolean;
  } = {},
): FrameCost {
  const behavior =
    backend === 'webgpu'
      ? WEBGPU_MILKDROP_BACKEND_BEHAVIOR
      : WEBGL_MILKDROP_BACKEND_BEHAVIOR;
  const { feedbackProfile } = behavior;
  const separable = options.separableBlur ?? false;
  const blurEnabled = options.blurEnabled ?? true;

  const passes: RenderPassCost[] = [];

  passes.push({
    name: 'scene',
    resolutionScale: feedbackProfile.sceneResolutionScale,
    textureSamplesPerPixel: 0,
    description: 'render source scene to sceneTarget',
  });

  passes.push({
    name: 'warp',
    resolutionScale: feedbackProfile.feedbackResolutionScale,
    textureSamplesPerPixel: 2,
    description: 'warp previous frame',
  });

  const compositeSamples =
    2 +
    (feedbackProfile.feedbackSoftness > MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD
      ? 9
      : 0);
  passes.push({
    name: 'composite',
    resolutionScale: feedbackProfile.feedbackResolutionScale,
    textureSamplesPerPixel: compositeSamples,
    description: 'composite (current + warp + softness taps)',
  });

  const blurPasses = analyzeBlurPasses(
    feedbackProfile.feedbackSoftness,
    feedbackProfile.feedbackResolutionScale,
    separable,
    blurEnabled,
  );
  passes.push(...blurPasses);

  passes.push({
    name: 'present',
    resolutionScale: 1,
    textureSamplesPerPixel: 1,
    description: 'present writeTarget to screen',
  });

  const totalSamples = passes.reduce(
    (sum, p) => sum + p.textureSamplesPerPixel * p.resolutionScale,
    0,
  );

  return {
    passes,
    totalSamplesPerPixelPixel: totalSamples,
    totalPasses: passes.length,
  };
}

describe('feedback pipeline performance analysis', () => {
  test('reports baseline (box blur, blur always on) webgl frame cost', () => {
    const cost = analyzeFrameCost('webgl');
    expect(cost.totalPasses).toBe(7);
    expect(cost.totalSamplesPerPixelPixel).toBeGreaterThan(0);
  });

  test('reports baseline (box blur, blur always on) webgpu frame cost', () => {
    const cost = analyzeFrameCost('webgpu');
    expect(cost.totalPasses).toBe(7);
    expect(cost.totalSamplesPerPixelPixel).toBeGreaterThan(0);
  });

  test('separable blur reduces sample count', () => {
    const baseline = analyzeFrameCost('webgpu');
    const optimized = analyzeFrameCost('webgpu', { separableBlur: true });
    expect(optimized.totalSamplesPerPixelPixel).toBeLessThan(
      baseline.totalSamplesPerPixelPixel,
    );
  });

  test('gating blur passes when preset has no blur references saves all blur passes', () => {
    const baseline = analyzeFrameCost('webgpu');
    const optimized = analyzeFrameCost('webgpu', { blurEnabled: false });
    expect(optimized.totalPasses).toBeLessThan(baseline.totalPasses);
    expect(optimized.totalSamplesPerPixelPixel).toBeLessThan(
      baseline.totalSamplesPerPixelPixel,
    );
  });

  test('combined separable blur + blur gating gives best result', () => {
    const baseline = analyzeFrameCost('webgpu');
    const optimized = analyzeFrameCost('webgpu', {
      separableBlur: true,
      blurEnabled: false,
    });
    expect(optimized.totalPasses).toBeLessThan(baseline.totalPasses);
    expect(optimized.totalSamplesPerPixelPixel).toBeLessThan(
      baseline.totalSamplesPerPixelPixel,
    );
  });
});
