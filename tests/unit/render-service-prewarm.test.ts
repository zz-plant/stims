import { afterEach, describe, expect, mock, test } from 'bun:test';
import * as rendererCapabilities from '../../src/js/core/renderer-capabilities.ts';
import { importFresh } from '../test-helpers.ts';

describe('render-service prewarm', () => {
  afterEach(async () => {
    mock.restore();
    const renderService = await importFresh<
      typeof import('../../src/js/core/services/render-service.ts')
    >('../../src/js/core/services/render-service.ts');
    renderService.resetRendererPool({ dispose: true });
  });

  test('prewarms renderer capabilities once and pins the automatic WebGPU preference', async () => {
    const getRendererCapabilities = mock(async () => ({
      preferredBackend: 'webgl' as const,
      adapter: null,
      device: null,
      fallbackReason: 'mocked',
      fallbackReasonCode: null,
      shouldRetryWebGPU: false,
      forceWebGL: true,
      webgpu: null,
    }));

    mock.module('../../src/js/core/renderer-capabilities.ts', () => ({
      ...rendererCapabilities,
      getRendererCapabilities,
      getRenderingSupport: () => ({
        hasWebGPU: true,
        hasWebGL: true,
      }),
      rememberRendererFallback: mock(),
      getCurrentRetrySnapshot: () => ({
        attempts: 0,
        maxAttempts: 3,
        lastFailureKind: null,
        lastFailureReason: null,
        nextRetryAt: null,
        canRetryNow: true,
      }),
    }));

    const renderService = await importFresh<
      typeof import('../../src/js/core/services/render-service.ts')
    >('../../src/js/core/services/render-service.ts');

    await renderService.prewarmRendererCapabilities();
    await renderService.prewarmRendererCapabilities();

    expect(getRendererCapabilities).toHaveBeenCalledTimes(1);
    expect(getRendererCapabilities).toHaveBeenCalledWith({
      preferWebGLForKnownCompatibilityGaps: true,
    });

    renderService.resetRendererPool({ dispose: true });
    await renderService.prewarmRendererCapabilities();

    expect(getRendererCapabilities).toHaveBeenCalledTimes(2);
  });
});
