import { afterEach, describe, expect, mock, test } from 'bun:test';
import { importFresh, replaceProperty } from './test-helpers.ts';

describe('renderer setup WebGPU fallback safety', () => {
  const originalConsoleInfo = console.info;
  const originalConsoleDebug = console.debug;
  let restoreUserAgent = () => {};

  afterEach(() => {
    mock.restore();
    console.info = originalConsoleInfo;
    console.debug = originalConsoleDebug;
    restoreUserAgent();
    restoreUserAgent = () => {};
    document.body.innerHTML = '';
  });

  test('falls back to WebGL when WebGPU renderer init stalls', async () => {
    const stalledRenderer = {
      setPixelRatio: mock(),
      setSize: mock(),
      setAnimationLoop: mock(),
      dispose: mock(),
      toneMappingExposure: 1,
    };

    const createWebGLRenderer = mock(() => ({
      setPixelRatio: mock(),
      setSize: mock(),
      setAnimationLoop: mock(),
      dispose: mock(),
      toneMappingExposure: 1,
    }));

    const requestDevice = mock(
      async () => ({ label: 'mock-device' }) as unknown as GPUDevice,
    );

    const rememberRendererFallback = mock();

    const consoleInfo = mock(() => {});
    const consoleDebug = mock(() => {});

    restoreUserAgent = replaceProperty(
      navigator,
      'userAgent',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
    );
    mock.module('../assets/js/core/webgl-check', () => ({
      ensureWebGL: () => true,
    }));
    mock.module('../assets/js/core/webgl-renderer', () => ({
      createWebGLRenderer,
    }));
    const getRendererCapabilities = mock(
      async (options?: { webgpuInitTimeoutMs?: number }) => {
        void options;
        return {
          adapter: { requestDevice },
          device: null,
        };
      },
    );

    mock.module('../assets/js/core/renderer-capabilities.ts', () => ({
      getRendererCapabilities,
      rememberRendererFallback,
    }));
    mock.module('../assets/js/core/renderer-plan.ts', () => ({
      deriveRendererPlan: () => ({
        backend: 'webgpu',
        reasonMessage: null,
        canRetryWebGPU: true,
      }),
    }));
    mock.module('../assets/js/core/webgpu-renderer.ts', () => ({
      WebGPURenderer: class MockWebGPURenderer {
        init() {
          return new Promise(() => {});
        }

        setPixelRatio = stalledRenderer.setPixelRatio;
        setSize = stalledRenderer.setSize;
        setAnimationLoop = stalledRenderer.setAnimationLoop;
        dispose = stalledRenderer.dispose;
      },
    }));

    console.info = consoleInfo;
    console.debug = consoleDebug;

    const { initRenderer } = await importFresh<
      typeof import('../assets/js/core/renderer-setup.ts')
    >('../assets/js/core/renderer-setup.ts');
    const result = await initRenderer(document.createElement('canvas'), {
      webgpuInitTimeoutMs: 5,
    });

    expect(result?.backend).toBe('webgl');
    expect(getRendererCapabilities).toHaveBeenCalledWith({
      forceRetry: false,
      preferWebGLForKnownCompatibilityGaps: true,
      webgpuInitTimeoutMs: 5,
    });
    expect(createWebGLRenderer).toHaveBeenCalledTimes(1);
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(stalledRenderer.setAnimationLoop).toHaveBeenCalledWith(null);
    expect(stalledRenderer.dispose).toHaveBeenCalledTimes(1);
    expect(rememberRendererFallback).toHaveBeenCalledWith(
      'WebGPU initialization failed.',
      expect.objectContaining({
        backend: 'webgl',
        shouldRetryWebGPU: true,
      }),
    );
  });
});
