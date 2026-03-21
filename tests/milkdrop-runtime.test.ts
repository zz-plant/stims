import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import {
  getMilkdropDetailScale,
  shouldFallbackPresetToWebgl,
} from '../assets/js/milkdrop/runtime.ts';

describe('milkdrop runtime detail scale', () => {
  test('boosts detail scale on webgpu for the same quality budget', () => {
    const webglScale = getMilkdropDetailScale({
      backend: 'webgl',
      particleScale: 1,
      particleBudget: 1,
    });
    const webgpuScale = getMilkdropDetailScale({
      backend: 'webgpu',
      particleScale: 1,
      particleBudget: 1,
    });

    expect(webgpuScale).toBeGreaterThan(webglScale);
    expect(webglScale).toBeCloseTo(1.1, 6);
    expect(webgpuScale).toBeCloseTo(1.55, 6);
  });

  test('applies shader quality multipliers to the shared detail scale', () => {
    const lowScale = getMilkdropDetailScale({
      backend: 'webgpu',
      particleScale: 1,
      particleBudget: 1,
      shaderQuality: 'low',
    });
    const balancedScale = getMilkdropDetailScale({
      backend: 'webgpu',
      particleScale: 1,
      particleBudget: 1,
      shaderQuality: 'balanced',
    });
    const highScale = getMilkdropDetailScale({
      backend: 'webgpu',
      particleScale: 1,
      particleBudget: 1,
      shaderQuality: 'high',
    });

    expect(lowScale).toBeLessThan(balancedScale);
    expect(highScale).toBeGreaterThan(balancedScale);
    expect(highScale).toBeCloseTo(1.86, 6);
  });

  test('respects the shared lower and upper bounds', () => {
    expect(
      getMilkdropDetailScale({
        backend: 'webgpu',
        particleScale: 0.2,
        particleBudget: 0.2,
      }),
    ).toBe(0.5);

    expect(
      getMilkdropDetailScale({
        backend: 'webgpu',
        particleScale: 2,
        particleBudget: 2,
      }),
    ).toBe(2);
  });
});

describe('milkdrop runtime compatibility fallback', () => {
  test('routes unsupported webgpu presets through the webgl compatibility path', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Fallback Preset
warp_code=shader_body=tex2d(sampler_main,uv).rgb;
      `.trim(),
      { id: 'fallback-preset' },
    );

    expect(
      shouldFallbackPresetToWebgl({
        activeBackend: 'webgpu',
        compatibilityModeEnabled: false,
        compiled,
      }),
    ).toBe(true);
    expect(
      shouldFallbackPresetToWebgl({
        activeBackend: 'webgl',
        compatibilityModeEnabled: false,
        compiled,
      }),
    ).toBe(false);
    expect(
      shouldFallbackPresetToWebgl({
        activeBackend: 'webgpu',
        compatibilityModeEnabled: true,
        compiled,
      }),
    ).toBe(false);
  });
});
