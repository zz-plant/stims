import { afterEach, describe, expect, mock, test } from 'bun:test';
import { importFresh, replaceProperty } from '../test-helpers.ts';

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
    mock.module('../../src/js/core/webgl-check', () => ({
      ensureWebGL: () => true,
    }));
    mock.module('../../src/js/core/webgl-renderer', () => ({
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

    mock.module('../../src/js/core/renderer-capabilities.ts', () => ({
      getRendererCapabilities,
      rememberRendererFallback,
    }));
    mock.module('../../src/js/core/renderer-plan.ts', () => ({
      deriveRendererPlan: () => ({
        backend: 'webgpu',
        reasonMessage: null,
        canRetryWebGPU: true,
      }),
    }));
    mock.module('../../src/js/core/webgpu-renderer.ts', () => ({
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
      typeof import('../../src/js/core/renderer-setup.ts')
    >('../../src/js/core/renderer-setup.ts');
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

  test('creates the WebGL fallback on a fresh canvas once WebGPU touched the original', async () => {
    // A canvas permanently binds its first context type. After a
    // WebGPURenderer is constructed on it, a WebGL fallback on the same
    // element gets no context and renders nothing (black stage).
    const createWebGLRenderer = mock(
      (config?: { canvas?: HTMLCanvasElement }) => {
        void config;
        return {
          setPixelRatio: mock(),
          setSize: mock(),
          setAnimationLoop: mock(),
          dispose: mock(),
          toneMappingExposure: 1,
        };
      },
    );

    restoreUserAgent = replaceProperty(
      navigator,
      'userAgent',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
    );
    mock.module('../../src/js/core/webgl-check', () => ({
      ensureWebGL: () => true,
    }));
    mock.module('../../src/js/core/webgl-renderer', () => ({
      createWebGLRenderer,
    }));
    mock.module('../../src/js/core/renderer-capabilities.ts', () => ({
      getRendererCapabilities: async () => ({
        adapter: {
          requestDevice: async () =>
            ({ label: 'mock-device' }) as unknown as GPUDevice,
        },
        device: null,
      }),
      rememberRendererFallback: mock(),
    }));
    mock.module('../../src/js/core/renderer-plan.ts', () => ({
      deriveRendererPlan: () => ({
        backend: 'webgpu',
        reasonMessage: null,
        canRetryWebGPU: true,
      }),
    }));
    mock.module('../../src/js/core/webgpu-renderer.ts', () => ({
      WebGPURenderer: class MockWebGPURenderer {
        init() {
          return new Promise(() => {});
        }

        setPixelRatio = mock();
        setSize = mock();
        setAnimationLoop = mock();
        dispose = mock();
      },
    }));

    console.info = mock(() => {});
    console.debug = mock(() => {});

    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.id = 'stage-canvas';
    canvas.width = 320;
    canvas.height = 240;
    container.appendChild(canvas);

    const { initRenderer } = await importFresh<
      typeof import('../../src/js/core/renderer-setup.ts')
    >('../../src/js/core/renderer-setup.ts');
    const result = await initRenderer(canvas, { webgpuInitTimeoutMs: 5 });

    expect(result?.backend).toBe('webgl');
    expect(createWebGLRenderer).toHaveBeenCalledTimes(1);
    const usedCanvas = createWebGLRenderer.mock.calls[0][0]?.canvas;
    expect(usedCanvas?.tagName).toBe('CANVAS');
    // Fresh element, swapped into the old canvas's DOM position with its
    // identity attributes intact.
    expect(usedCanvas).not.toBe(canvas);
    expect(usedCanvas?.id).toBe('stage-canvas');
    expect(usedCanvas?.width).toBe(320);
    expect(usedCanvas?.parentNode).toBe(container);
    expect(canvas.parentNode).toBe(null);
  });

  test('keeps the original canvas when fallback happens before WebGPU construction', async () => {
    const createWebGLRenderer = mock(
      (config?: { canvas?: HTMLCanvasElement }) => {
        void config;
        return {
          setPixelRatio: mock(),
          setSize: mock(),
          setAnimationLoop: mock(),
          dispose: mock(),
          toneMappingExposure: 1,
        };
      },
    );

    restoreUserAgent = replaceProperty(
      navigator,
      'userAgent',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
    );
    mock.module('../../src/js/core/webgl-check', () => ({
      ensureWebGL: () => true,
    }));
    mock.module('../../src/js/core/webgl-renderer', () => ({
      createWebGLRenderer,
    }));
    mock.module('../../src/js/core/renderer-capabilities.ts', () => ({
      // No adapter — the plan resolves to WebGL before any WebGPU renderer
      // is constructed, so the canvas is never at risk and must be reused.
      getRendererCapabilities: async () => null,
      rememberRendererFallback: mock(),
    }));
    mock.module('../../src/js/core/renderer-plan.ts', () => ({
      deriveRendererPlan: () => ({
        backend: 'webgl',
        reasonMessage: 'WebGPU unavailable.',
        canRetryWebGPU: false,
      }),
    }));

    console.info = mock(() => {});
    console.debug = mock(() => {});

    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);

    const { initRenderer } = await importFresh<
      typeof import('../../src/js/core/renderer-setup.ts')
    >('../../src/js/core/renderer-setup.ts');
    const result = await initRenderer(canvas, { webgpuInitTimeoutMs: 5 });

    expect(result?.backend).toBe('webgl');
    expect(createWebGLRenderer).toHaveBeenCalledTimes(1);
    expect(createWebGLRenderer.mock.calls[0][0]?.canvas).toBe(canvas);
  });
});
