import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const capabilitiesModule = '../assets/js/core/renderer-capabilities.ts';
const freshImport = async () =>
  import(`${capabilitiesModule}?t=${Date.now()}-${Math.random()}`);

let getRendererCapabilities;
let getRendererOptimizationSupport;
let getRenderingSupport;
let recordRendererOptimizationTelemetry;
let rememberRendererFallback;
let resetRendererCapabilities;
let summarizeRendererOptimizationSupport;

const originalNavigator = global.navigator;
const COMPATIBILITY_MODE_KEY = 'stims:compatibility-mode';

async function resetRenderPreferencesState() {
  const { resetRenderPreferencesState: resetPreferences } = await import(
    '../assets/js/core/render-preferences.ts'
  );
  resetPreferences();
}

function mockNavigatorWithGPU({ device = {}, adapter = {} } = {}) {
  const requestDevice = mock(async () => device);
  const requestAdapter = mock(async () => ({
    features: new Set(),
    limits: {},
    requestDevice,
    ...adapter,
  }));
  Object.defineProperty(global, 'navigator', {
    writable: true,
    configurable: true,
    value: {
      gpu: {
        requestAdapter,
        getPreferredCanvasFormat: () => 'bgra8unorm',
      },
    },
  });
  return { requestAdapter, requestDevice };
}

beforeEach(async () => {
  mock.restore();
  await resetRenderPreferencesState();
  window.localStorage.removeItem(COMPATIBILITY_MODE_KEY);
  ({
    getRendererCapabilities,
    getRendererOptimizationSupport,
    getRenderingSupport,
    recordRendererOptimizationTelemetry,
    rememberRendererFallback,
    resetRendererCapabilities,
    summarizeRendererOptimizationSupport,
  } = await freshImport());
});

afterEach(async () => {
  resetRendererCapabilities();
  mock.restore();
  window.localStorage.removeItem(COMPATIBILITY_MODE_KEY);
  await resetRenderPreferencesState();
  Object.defineProperty(global, 'navigator', {
    writable: true,
    configurable: true,
    value: originalNavigator,
  });
});

describe('renderer capabilities', () => {
  test('caches adapter probing across calls', async () => {
    const { requestAdapter, requestDevice } = mockNavigatorWithGPU({
      device: { label: 'device' },
    });

    const first = await getRendererCapabilities();
    const second = await getRendererCapabilities();

    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(first.adapter).toBe(second.adapter);
    expect(first.device).toBe(second.device);
    expect(second.preferredBackend).toBe('webgpu');
    expect(second.webgpu?.preferredCanvasFormat).toBe('bgra8unorm');
  });

  test('still probes WebGPU on capable mobile browsers', async () => {
    const { requestAdapter, requestDevice } = mockNavigatorWithGPU({
      device: { label: 'mobile-device' },
    });

    Object.defineProperty(global.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });

    const result = await getRendererCapabilities({ forceRetry: true });

    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(result.preferredBackend).toBe('webgpu');
    expect(result.fallbackReason).toBeNull();
    expect(result.forceWebGL).toBe(false);
  });

  test('forces WebGL on guarded mobile browsers with known WebGPU instability', async () => {
    const { requestAdapter, requestDevice } = mockNavigatorWithGPU({
      device: { label: 'mobile-device' },
    });

    Object.defineProperty(global.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Linux; Android 15; SAMSUNG SM-S928U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/124.0.0.0 Mobile Safari/537.36',
    });

    const result = await getRendererCapabilities({ forceRetry: true });

    expect(requestAdapter).toHaveBeenCalledTimes(0);
    expect(requestDevice).toHaveBeenCalledTimes(0);
    expect(
      result.preferredBackend === 'webgl' || result.preferredBackend === null,
    ).toBe(true);
    expect(result.fallbackReason).toContain(
      'temporarily disabled on this mobile browser',
    );
    expect(result.forceWebGL).toBe(true);
  });

  test('falls back when WebGPU device acquisition times out during capability probing', async () => {
    const requestDevice = mock(() => new Promise(() => {}));
    const requestAdapter = mock(async () => ({
      features: new Set(),
      limits: {},
      requestDevice,
    }));

    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: {
        gpu: {
          requestAdapter,
          getPreferredCanvasFormat: () => 'bgra8unorm',
        },
      },
    });

    const result = await getRendererCapabilities({
      forceRetry: true,
      webgpuInitTimeoutMs: 5,
    });

    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(
      result.preferredBackend === 'webgl' || result.preferredBackend === null,
    ).toBe(true);
    expect(result.fallbackReason).toBe('Unable to acquire a WebGPU device.');
    expect(result.shouldRetryWebGPU).toBe(true);
    expect(result.device).toBeNull();
    expect(result.adapter).toBeNull();
  });

  test('falls back to WebGL when only a fallback WebGPU adapter is available', async () => {
    const requestDevice = mock(async () => ({ label: 'fallback-device' }));
    const requestAdapter = mock(async () => ({
      isFallbackAdapter: true,
      features: new Set(),
      limits: {},
      requestDevice,
    }));

    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: {
        gpu: {
          requestAdapter,
          getPreferredCanvasFormat: () => 'bgra8unorm',
        },
      },
    });

    const result = await getRendererCapabilities({ forceRetry: true });

    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestDevice).toHaveBeenCalledTimes(0);
    expect(
      result.preferredBackend === 'webgl' || result.preferredBackend === null,
    ).toBe(true);
    expect(result.fallbackReason).toBe(
      'Only a fallback WebGPU adapter is available. Using WebGL for performance and compatibility.',
    );
    expect(result.fallbackReasonCode).toBe('FALLBACK_ADAPTER');
    expect(result.shouldRetryWebGPU).toBe(false);
    expect(result.forceWebGL).toBe(false);
  });

  test('falls back to WebGL when WebGPU is missing', async () => {
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: {},
    });

    const result = await getRendererCapabilities({ forceRetry: true });

    expect(result.preferredBackend).toBeNull();
    expect(result.fallbackReason).toContain('WebGPU');
    expect(result.shouldRetryWebGPU).toBe(false);
    expect(result.forceWebGL).toBe(false);
  });

  test('reports WebGL support when a canvas context is available', () => {
    const originalCreateElement = document.createElement.bind(document);
    const getContext = mock((kind) => (kind === 'webgl' ? {} : null));
    document.createElement = mock((tagName, options) => {
      const element = originalCreateElement(tagName, options);
      if (tagName === 'canvas') {
        element.getContext = getContext;
      }
      return element;
    });

    const support = getRenderingSupport();

    expect(support.hasWebGL).toBe(true);
    expect(getContext).toHaveBeenCalled();
  });

  test('marks forced WebGL when compatibility mode is enabled', async () => {
    window.localStorage.setItem(COMPATIBILITY_MODE_KEY, 'true');
    await resetRenderPreferencesState();

    const result = await getRendererCapabilities({ forceRetry: true });

    expect(result.preferredBackend).toBe('webgl');
    expect(result.fallbackReason).toContain('Compatibility mode');
    expect(result.forceWebGL).toBe(true);
  });

  test('retains fallback preference when renderer creation fails', async () => {
    mockNavigatorWithGPU({ device: { label: 'device' } });

    await getRendererCapabilities({ forceRetry: true });
    const recorded = rememberRendererFallback('Renderer creation failed.', {
      shouldRetryWebGPU: true,
      backend: 'webgl',
    });

    expect(recorded.preferredBackend).toBe('webgl');
    const replay = await getRendererCapabilities();
    expect(replay.fallbackReason).toContain('Renderer creation failed.');
    expect(replay.shouldRetryWebGPU).toBe(true);
  });

  test('captures high-end WebGPU feature support for richer defaults', async () => {
    await resetRenderPreferencesState();
    mockNavigatorWithGPU({
      device: { label: 'device' },
      adapter: {
        features: new Set([
          'shader-f16',
          'subgroups',
          'timestamp-query',
          'float32-blendable',
          'float32-filterable',
          'bgra8unorm-storage',
        ]),
        limits: {
          maxColorAttachments: 8,
          maxComputeInvocationsPerWorkgroup: 1024,
          maxStorageBufferBindingSize: 4294967292,
          maxTextureDimension2D: 16384,
        },
      },
    });

    const result = await getRendererCapabilities({ forceRetry: true });

    expect(result.webgpu).toMatchObject({
      performanceTier: 'high-end',
      recommendedQualityPreset: 'hi-fi',
      preferredCanvasFormat: 'bgra8unorm',
      optimization: {
        shaderF16: true,
        subgroups: true,
        timestampQuery: true,
        workerOffscreenPipeline: false,
      },
      features: {
        shaderF16: true,
        subgroups: true,
        timestampQuery: true,
      },
    });
  });

  test('provides a stable optimization support snapshot without reprobe helpers', () => {
    const optimization = summarizeRendererOptimizationSupport({
      features: {
        shaderF16: true,
        subgroups: false,
        timestampQuery: true,
      },
      workers: {
        workers: true,
        offscreenCanvas: true,
        transferControlToOffscreen: true,
      },
    });

    expect(optimization).toEqual({
      shaderF16: true,
      subgroups: false,
      timestampQuery: true,
      workers: true,
      offscreenCanvas: true,
      transferControlToOffscreen: true,
      workerOffscreenPipeline: true,
    });
    expect(getRendererOptimizationSupport({ webgpu: { optimization } })).toBe(
      optimization,
    );
    expect(getRendererOptimizationSupport(null)).toEqual({
      shaderF16: false,
      subgroups: false,
      timestampQuery: false,
      workers: false,
      offscreenCanvas: false,
      transferControlToOffscreen: false,
      workerOffscreenPipeline: false,
    });
  });

  test('dispatches optimization telemetry events for opt-in counters', () => {
    const dispatchEvent = mock();
    const originalDispatchEvent = window.dispatchEvent;
    window.dispatchEvent = dispatchEvent;

    recordRendererOptimizationTelemetry({
      counter: 'shaderF16Usage',
      amount: 2,
    });

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0].type).toBe(
      'stims:renderer-optimization-telemetry',
    );
    expect(dispatchEvent.mock.calls[0][0].detail).toEqual({
      counter: 'shaderF16Usage',
      amount: 2,
    });

    window.dispatchEvent = originalDispatchEvent;
  });
});
