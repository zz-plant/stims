import { afterEach, describe, expect, mock, test } from 'bun:test';

const freshImport = async () =>
  import(
    `../assets/js/core/renderer-setup.ts?ts=${Date.now()}-${Math.random()}`
  );

describe('renderer setup WebGPU fallback safety', () => {
  const originalConsoleInfo = console.info;
  const originalConsoleDebug = console.debug;

  afterEach(() => {
    mock.restore();
    console.info = originalConsoleInfo;
    console.debug = originalConsoleDebug;
    document.body.innerHTML = '';
  });

  test('falls back to WebGL when WebGPU renderer init stalls', async () => {
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

    mock.module('../assets/js/utils/device-detect', () => ({
      isMobileDevice: () => false,
    }));
    mock.module('../assets/js/utils/webgl-check', () => ({
      ensureWebGL: () => true,
    }));
    mock.module('../assets/js/utils/webgl-renderer', () => ({
      createWebGLRenderer,
    }));
    mock.module('../assets/js/core/renderer-capabilities.ts', () => ({
      getRendererCapabilities: async () => ({
        adapter: { requestDevice },
        device: null,
      }),
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

        setPixelRatio() {}
        setSize() {}
        setAnimationLoop() {}
      },
    }));

    console.info = consoleInfo;
    console.debug = consoleDebug;

    const { initRenderer } = await freshImport();
    const result = await initRenderer(document.createElement('canvas'), {
      webgpuInitTimeoutMs: 5,
    });

    expect(result?.backend).toBe('webgl');
    expect(createWebGLRenderer).toHaveBeenCalledTimes(1);
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(rememberRendererFallback).toHaveBeenCalledWith(
      'WebGPU initialization failed.',
      expect.objectContaining({
        backend: 'webgl',
        shouldRetryWebGPU: true,
      }),
    );
  });
});
