import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const capabilitiesModule = '../assets/js/core/renderer-capabilities.ts';
const freshImport = async () =>
  import(`${capabilitiesModule}?t=${Date.now()}-${Math.random()}`);

let getRendererCapabilities;
let rememberRendererFallback;
let resetRendererCapabilities;

const originalNavigator = global.navigator;

function mockNavigatorWithGPU({ device = {} } = {}) {
  const requestDevice = mock(async () => device);
  const requestAdapter = mock(async () => ({ requestDevice }));
  Object.defineProperty(global, 'navigator', {
    writable: true,
    configurable: true,
    value: { gpu: { requestAdapter } },
  });
  return { requestAdapter, requestDevice };
}

beforeEach(async () => {
  mock.restore();
  ({
    getRendererCapabilities,
    rememberRendererFallback,
    resetRendererCapabilities,
  } = await freshImport());
});

afterEach(() => {
  resetRendererCapabilities();
  mock.restore();
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
  });

  test('falls back to WebGL when WebGPU is missing', async () => {
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: {},
    });

    const result = await getRendererCapabilities({ forceRetry: true });

    expect(result.preferredBackend).toBe('webgl');
    expect(result.fallbackReason).toContain('WebGPU');
    expect(result.shouldRetryWebGPU).toBe(false);
  });

  test('retains fallback preference when renderer creation fails', async () => {
    mockNavigatorWithGPU({ device: { label: 'device' } });

    await getRendererCapabilities({ forceRetry: true });
    const recorded = rememberRendererFallback('Renderer creation failed.', {
      shouldRetryWebGPU: true,
    });

    expect(recorded.preferredBackend).toBe('webgl');
    const replay = await getRendererCapabilities();
    expect(replay.fallbackReason).toContain('Renderer creation failed.');
    expect(replay.shouldRetryWebGPU).toBe(true);
  });
});
