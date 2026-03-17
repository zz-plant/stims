import { describe, expect, test } from 'bun:test';
import { getMilkdropDetailScale } from '../assets/js/milkdrop/runtime.ts';

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
    expect(webgpuScale).toBeCloseTo(1.35, 6);
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
