import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { importFresh, replaceProperty } from '../test-helpers.ts';

const capabilitiesModule = '../../src/js/core/renderer-capabilities.ts';

let getRendererCapabilities;
let getRendererOptimizationSupport;
let getRenderingSupport;
let recordRendererOptimizationTelemetry;
let rememberRendererFallback;
let resetRendererCapabilities;
let resolveCapabilityProbeSuccess;
let summarizeRendererOptimizationSupport;

const COMPATIBILITY_MODE_KEY = 'stims:compatibility-mode';
let restoreNavigator = () => {};

async function resetRenderPreferencesState() {
  const { resetRenderPreferencesState: resetPreferences } = await import(
    '../../src/js/core/render-preferences.ts'
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
  restoreNavigator();
  restoreNavigator = replaceProperty(global, 'navigator', {
    gpu: {
      requestAdapter,
      getPreferredCanvasFormat: () => 'bgra8unorm',
    },
  });
  return { requestAdapter, requestDevice };
}

let originalCreateElement;

beforeEach(async () => {
  mock.restore();
  if (!originalCreateElement) {
    originalCreateElement = document.createElement.bind(document);
  }
  document.createElement = mock((tagName, options) => {
    const element = originalCreateElement(tagName, options);
    if (tagName === 'canvas') {
      const originalGetContext = element.getContext.bind(element);
      element.getContext = mock((kind) => {
        if (kind === 'webgpu') {
          return {};
        }
        const ctx = originalGetContext(kind);
        if (kind === 'webgl' && !ctx) {
          return {};
        }
        return ctx;
      });
    }
    return element;
  });

  await resetRenderPreferencesState();
  window.localStorage.removeItem(COMPATIBILITY_MODE_KEY);
  ({
    getRendererCapabilities,
    getRendererOptimizationSupport,
    getRenderingSupport,
    recordRendererOptimizationTelemetry,
    rememberRendererFallback,
    resetRendererCapabilities,
    resolveCapabilityProbeSuccess,
    summarizeRendererOptimizationSupport,
  } = await importFresh(capabilitiesModule));
});

afterEach(async () => {
  if (originalCreateElement) {
    document.createElement = originalCreateElement;
  }
  resetRendererCapabilities();
  mock.restore();
  window.localStorage.removeItem(COMPATIBILITY_MODE_KEY);
  await resetRenderPreferencesState();
  restoreNavigator();
  restoreNavigator = () => {};
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

  test('can prefer WebGL when automatic WebGPU is blocked for this session', async () => {
    const { requestAdapter, requestDevice } = mockNavigatorWithGPU({
      device: { label: 'desktop-device' },
    });

    const result = await getRendererCapabilities({
      forceRetry: true,
      preferWebGLForKnownCompatibilityGaps: true,
    });

    expect(requestAdapter).toHaveBeenCalledTimes(0);
    expect(requestDevice).toHaveBeenCalledTimes(0);
    expect(
      result.preferredBackend === 'webgl' || result.preferredBackend === null,
    ).toBe(true);
    expect(result.fallbackReason).toContain(
      'not enabled automatically for this browser or session',
    );
    expect(result.forceWebGL).toBe(true);
  });

  test('keeps cache entries distinct when the automatic WebGPU preference changes', async () => {
    const { requestAdapter, requestDevice } = mockNavigatorWithGPU({
      device: { label: 'desktop-device' },
    });

    const first = await getRendererCapabilities({ forceRetry: true });
    const second = await getRendererCapabilities({
      preferWebGLForKnownCompatibilityGaps: true,
    });
    const third = await getRendererCapabilities({
      preferWebGLForKnownCompatibilityGaps: false,
    });

    expect(first.preferredBackend).toBe('webgpu');
    expect(
      second.preferredBackend === 'webgl' || second.preferredBackend === null,
    ).toBe(true);
    expect(third.preferredBackend).toBe('webgpu');
    expect(requestAdapter).toHaveBeenCalledTimes(2);
    expect(requestDevice).toHaveBeenCalledTimes(2);
  });

  test('falls back when WebGPU device acquisition times out during capability probing', async () => {
    const requestDevice = mock(() => new Promise(() => {}));
    const requestAdapter = mock(async () => ({
      features: new Set(),
      limits: {},
      requestDevice,
    }));

    restoreNavigator();
    restoreNavigator = replaceProperty(global, 'navigator', {
      gpu: {
        requestAdapter,
        getPreferredCanvasFormat: () => 'bgra8unorm',
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

  test('cleans up a device and records a retryable no-adapter invariant failure', () => {
    const destroy = mock(() => {});

    const result = resolveCapabilityProbeSuccess({
      adapter: null,
      device: { destroy },
      retry: {
        attempts: 0,
        maxAttempts: 3,
        lastFailureKind: null,
        lastFailureReason: null,
        nextRetryAt: null,
        canRetryNow: true,
      },
    });

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(result.fallbackReasonCode).toBe('NO_ADAPTER');
    expect(result.shouldRetryWebGPU).toBe(true);
    expect(result.retry).toMatchObject({
      attempts: 1,
      lastFailureKind: 'unknown',
      lastFailureReason: 'No compatible WebGPU adapter was found.',
    });
  });

  test('records a retryable no-device invariant failure', () => {
    const result = resolveCapabilityProbeSuccess({
      adapter: { features: new Set(), limits: {} },
      device: null,
      retry: {
        attempts: 0,
        maxAttempts: 3,
        lastFailureKind: null,
        lastFailureReason: null,
        nextRetryAt: null,
        canRetryNow: true,
      },
    });

    expect(result.fallbackReasonCode).toBe('NO_DEVICE');
    expect(result.shouldRetryWebGPU).toBe(true);
    expect(result.retry).toMatchObject({
      attempts: 1,
      lastFailureKind: 'device-request',
      lastFailureReason: 'Unable to acquire a WebGPU device.',
    });
  });

  test('falls back to WebGL when only a fallback WebGPU adapter is available', async () => {
    const requestDevice = mock(async () => ({ label: 'fallback-device' }));
    const requestAdapter = mock(async () => ({
      isFallbackAdapter: true,
      features: new Set(),
      limits: {},
      requestDevice,
    }));

    restoreNavigator();
    restoreNavigator = replaceProperty(global, 'navigator', {
      gpu: {
        requestAdapter,
        getPreferredCanvasFormat: () => 'bgra8unorm',
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

  test('records a retryable fallback when the cached WebGPU device is lost', async () => {
    let resolveLost;
    const lost = new Promise((resolve) => {
      resolveLost = resolve;
    });
    const { requestAdapter, requestDevice } = mockNavigatorWithGPU({
      device: {
        label: 'device',
        lost,
      },
    });

    const first = await getRendererCapabilities({ forceRetry: true });
    expect(first.preferredBackend).toBe('webgpu');

    resolveLost?.({ message: 'mock loss' });
    await Promise.resolve();
    await Promise.resolve();

    const replay = await getRendererCapabilities();

    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(
      replay.preferredBackend === 'webgl' || replay.preferredBackend === null,
    ).toBe(true);
    expect(replay.fallbackReason).toContain('WebGPU device was lost');
    expect(replay.shouldRetryWebGPU).toBe(true);
  });

  test('falls back to WebGL when WebGPU is missing', async () => {
    restoreNavigator();
    restoreNavigator = replaceProperty(global, 'navigator', {});

    const result = await getRendererCapabilities({ forceRetry: true });

    expect(result.preferredBackend).toBe('webgl');
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
      recommendedQualityPreset: 'ultra',
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

  test('keeps high-end mobile WebGPU sessions on balanced startup quality', async () => {
    await resetRenderPreferencesState();
    mockNavigatorWithGPU({
      device: { label: 'iphone-device' },
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

    Object.defineProperty(global.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    Object.defineProperty(global.navigator, 'platform', {
      configurable: true,
      value: 'iPhone',
    });
    Object.defineProperty(global.navigator, 'maxTouchPoints', {
      configurable: true,
      value: 5,
    });

    const result = await getRendererCapabilities({ forceRetry: true });

    expect(result.webgpu).toMatchObject({
      performanceTier: 'high-end',
      recommendedQualityPreset: 'balanced',
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
