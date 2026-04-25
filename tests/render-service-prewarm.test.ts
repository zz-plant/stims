import { afterEach, describe, expect, mock, test } from 'bun:test';
import { importFresh } from './test-helpers.ts';

describe('render-service prewarm', () => {
  afterEach(async () => {
    mock.restore();
    const renderService = await importFresh<
      typeof import('../assets/js/core/services/render-service.ts')
    >('../assets/js/core/services/render-service.ts');
    renderService.resetRendererPool({ dispose: true });
  });

  test('prewarms renderer capabilities once and pins the live-visualizer fallback option', async () => {
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

    mock.module('../assets/js/core/renderer-capabilities.ts', () => ({
      getRendererCapabilities,
      getRenderingSupport: () => ({
        hasWebGPU: true,
        hasWebGL: true,
      }),
      rememberRendererFallback: mock(),
    }));

    const renderService = await importFresh<
      typeof import('../assets/js/core/services/render-service.ts')
    >('../assets/js/core/services/render-service.ts');

    await renderService.prewarmRendererCapabilities();
    await renderService.prewarmRendererCapabilities();

    expect(getRendererCapabilities).toHaveBeenCalledTimes(1);
    expect(getRendererCapabilities).toHaveBeenCalledWith({
      preferWebGLForKnownCompatibilityGaps: false,
    });

    renderService.resetRendererPool({ dispose: true });
    await renderService.prewarmRendererCapabilities();

    expect(getRendererCapabilities).toHaveBeenCalledTimes(2);
  });
});
