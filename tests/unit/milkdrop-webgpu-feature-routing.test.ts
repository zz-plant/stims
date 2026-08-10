import { afterEach, describe, expect, test } from 'bun:test';
import { resolveMilkdropWebGpuOptimizationFlags } from '../../src/js/milkdrop/webgpu-optimization-flags.ts';
import {
  resolveMilkdropWebGpuFeatureRouting,
  setWebGpuForceMode,
  shouldEnableNativeMilkdropWebGpuFeedback,
} from '../../src/js/milkdrop/webgpu-query-override.ts';

describe('MilkDrop WebGPU feature routing', () => {
  afterEach(() => {
    setWebGpuForceMode('auto');
  });

  test('disables feature-level routes in safe mode instead of using one opaque switch', () => {
    setWebGpuForceMode('safe');

    const routing = resolveMilkdropWebGpuFeatureRouting({ search: '' });

    expect(routing.proceduralMainWave).toMatchObject({ enabled: false });
    expect(routing.directFeedbackShaders.reason).toContain('safe path');
    expect(routing.renderBundles.enabled).toBe(false);
  });

  test('keeps render bundles opt-in even when full WebGPU is forced by URL', () => {
    const routing = resolveMilkdropWebGpuFeatureRouting({
      search: '?renderer=webgpu&corpus=certification',
    });

    expect(routing.proceduralMesh.enabled).toBe(true);
    expect(routing.directFeedbackShaders).toMatchObject({
      enabled: true,
      reason: null,
    });
    expect(routing.renderBundles).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('render bundles remain opt-in'),
    });
  });

  test('enables render bundles only through the render-bundles rollout flag', () => {
    const routing = resolveMilkdropWebGpuFeatureRouting({
      search: '?renderer=webgpu&milkdrop-webgpu-render-bundles=1',
    });

    expect(routing.renderBundles).toEqual({
      enabled: true,
      reason: null,
    });
  });

  test('enables native feedback on the full WebGPU path', () => {
    const routing = resolveMilkdropWebGpuFeatureRouting({
      search: '?renderer=webgpu',
    });

    expect(routing.directFeedbackShaders).toEqual({
      enabled: true,
      reason: null,
    });
  });

  test('enables native feedback for full-path sessions but not the safe path', () => {
    setWebGpuForceMode('full');
    expect(
      shouldEnableNativeMilkdropWebGpuFeedback({
        search: '?renderer=webgpu&corpus=certification',
      }),
    ).toBe(true);
    expect(shouldEnableNativeMilkdropWebGpuFeedback({ search: '' })).toBe(true);

    setWebGpuForceMode('safe');
    expect(
      shouldEnableNativeMilkdropWebGpuFeedback({ search: '?renderer=webgpu' }),
    ).toBe(false);
  });

  test('keeps WebGPU sessions off the preemptive WebGL fallback by default', () => {
    expect(
      resolveMilkdropWebGpuOptimizationFlags({
        location: { search: '?renderer=webgpu&corpus=certification' },
        storage: { getItem: () => null },
      }).descriptorFallbackToWebgl,
    ).toBe(false);
    expect(
      resolveMilkdropWebGpuOptimizationFlags({
        location: { search: '?renderer=webgpu' },
        storage: { getItem: () => null },
      }).descriptorFallbackToWebgl,
    ).toBe(false);
    // An explicit opt-in still routes feedback presets to WebGL.
    expect(
      resolveMilkdropWebGpuOptimizationFlags({
        location: { search: '?milkdrop-webgpu-fallback=1' },
        storage: { getItem: () => null },
      }).descriptorFallbackToWebgl,
    ).toBe(true);
  });
});
