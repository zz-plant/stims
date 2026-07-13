import { afterEach, describe, expect, test } from 'bun:test';
import {
  resolveMilkdropWebGpuFeatureRouting,
  setWebGpuForceMode,
} from '../assets/js/milkdrop/webgpu-query-override.ts';

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
      enabled: false,
      reason: expect.stringContaining('native WebGPU feedback'),
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

  test('keeps native feedback disabled on the full path until material parity is proven', () => {
    const routing = resolveMilkdropWebGpuFeatureRouting({
      search: '?renderer=webgpu',
    });

    expect(routing.directFeedbackShaders).toEqual({
      enabled: false,
      reason:
        'native WebGPU feedback remains disabled until ShaderMaterial and TSL composite parity is stable',
    });
  });
});
