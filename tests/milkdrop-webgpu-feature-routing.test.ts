import { describe, expect, test } from 'bun:test';
import {
  resolveMilkdropWebGpuFeatureRouting,
  setWebGpuForceMode,
} from '../assets/js/milkdrop/webgpu-query-override.ts';

describe('MilkDrop WebGPU feature routing', () => {
  test('disables feature-level routes in safe mode instead of using one opaque switch', () => {
    setWebGpuForceMode('safe');

    const routing = resolveMilkdropWebGpuFeatureRouting({ search: '' });

    expect(routing.proceduralMainWave).toMatchObject({ enabled: false });
    expect(routing.directFeedbackShaders.reason).toContain('safe path');
    expect(routing.renderBundles.enabled).toBe(false);

    setWebGpuForceMode('auto');
  });

  test('keeps render bundles opt-in even when full WebGPU is forced by URL', () => {
    setWebGpuForceMode('auto');

    const routing = resolveMilkdropWebGpuFeatureRouting({
      search: '?renderer=webgpu&corpus=certification',
    });

    expect(routing.proceduralMesh.enabled).toBe(true);
    expect(routing.directFeedbackShaders).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('native WebGPU feedback'),
    });
    expect(routing.renderBundles.enabled).toBe(true);
  });
});
