import { expect, test } from 'bun:test';
import { createMilkdropEnhancedEffectsPolicy } from '../../src/js/milkdrop/runtime/enhanced-effects-policy.ts';
import type { MilkdropFrameState } from '../../src/js/milkdrop/types.ts';

test('reuses enhanced-effects policy storage across performance frames', () => {
  const applyPolicy = createMilkdropEnhancedEffectsPolicy();
  const first = {
    title: 'first',
    interaction: { mesh: { amount: 1 } },
    mainWave: { thickness: 8 },
    post: { postprocessingProfile: { enabled: true } },
    gpuGeometry: { particleField: { enabled: true, instanceCount: 96 } },
  } as unknown as MilkdropFrameState;
  const second = {
    title: 'second',
    mainWave: { thickness: 6 },
    post: { postprocessingProfile: { enabled: true } },
    gpuGeometry: { particleField: { enabled: true, instanceCount: 48 } },
  } as unknown as MilkdropFrameState;

  const firstOutput = applyPolicy({
    frameState: first,
    shaderQuality: 'balanced',
    qualityPresetId: 'performance',
  });
  const firstPost = firstOutput.post;
  const secondOutput = applyPolicy({
    frameState: second,
    shaderQuality: 'balanced',
    qualityPresetId: 'performance',
  });

  expect(secondOutput).toBe(firstOutput);
  expect(secondOutput.post).toBe(firstPost);
  expect(secondOutput.title).toBe('second');
  expect(secondOutput.interaction).toBeUndefined();
  expect(secondOutput.post.postprocessingProfile?.enabled).toBe(false);
  expect(secondOutput.gpuGeometry.particleField?.enabled).toBe(false);
  expect(secondOutput.gpuGeometry.particleField?.instanceCount).toBe(48);
});
