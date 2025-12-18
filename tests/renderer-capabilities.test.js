import { afterEach, describe, expect, mock, test } from 'bun:test';

const capabilitiesModulePath = '../assets/js/core/renderer-capabilities.ts';
const rendererSetupModulePath = '../assets/js/core/renderer-setup.ts';

const freshImport = async (path) =>
  import(`${path}?t=${Date.now()}-${Math.random()}`);

const originalNavigator = global.navigator;

function mockRendererModules() {
  class MockRenderer {
    outputColorSpace = null;
    toneMapping = null;
    toneMappingExposure = 1;
    setPixelRatio() {}
    setSize() {}
  }

  mock.module('three', () => ({
    WebGLRenderer: MockRenderer,
    SRGBColorSpace: 'srgb',
    ACESFilmicToneMapping: 'aces',
  }));

  mock.module('three/src/renderers/webgpu/WebGPURenderer.js', () => ({
    default: class extends MockRenderer {},
  }));
}

describe('renderer capabilities', () => {
  afterEach(() => {
    mock.restore();
    document.body.innerHTML = '';
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });

  test('caches adapter probe when WebGPU is unavailable', async () => {
    const requestAdapter = mock(() => Promise.resolve(null));
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { gpu: { requestAdapter } },
    });

    mock.module('../assets/js/utils/webgl-check.js', () => ({ ensureWebGL: () => true }));
    mock.module('three/examples/jsm/capabilities/WebGL.js', () => ({
      default: { isWebGLAvailable: () => true },
    }));

    const { getRendererCapabilities, resetRendererCapabilitiesCache } =
      await freshImport(capabilitiesModulePath);

    await getRendererCapabilities();
    await getRendererCapabilities();

    expect(requestAdapter).toHaveBeenCalledTimes(1);

    resetRendererCapabilitiesCache();
  });

  test('initRenderer reuses cached WebGL preference without re-requesting adapter', async () => {
    const requestAdapter = mock(() => Promise.resolve(null));
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { gpu: { requestAdapter } },
    });

    mock.module('../assets/js/utils/webgl-check.js', () => ({ ensureWebGL: () => true }));
    mock.module('three/examples/jsm/capabilities/WebGL.js', () => ({
      default: { isWebGLAvailable: () => true },
    }));
    mockRendererModules();

    const { getRendererCapabilities, resetRendererCapabilitiesCache } =
      await freshImport(capabilitiesModulePath);
    const capabilities = await getRendererCapabilities();

    const { initRenderer } = await freshImport(rendererSetupModulePath);
    const canvas = document.createElement('canvas');

    await initRenderer(canvas, {
      preferredBackend: capabilities.preferredBackend,
      adapter: capabilities.adapter,
    });

    expect(requestAdapter).toHaveBeenCalledTimes(1);

    resetRendererCapabilitiesCache();
  });
});
