import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createRouter } from '../assets/js/router.ts';
import { createToyView } from '../assets/js/toy-view.ts';
import { defaultToyLifecycle } from '../assets/js/core/toy-lifecycle.ts';

const originalLocation = window.location;
const originalHistory = window.history;
const originalNavigator = global.navigator;

const defaultCapabilities = {
  preferredBackend: 'webgpu',
  adapter: {},
  device: {},
  triedWebGPU: true,
  fallbackReason: null,
  shouldRetryWebGPU: false,
};

let capabilitiesMock;
const servicesMock = {
  prewarmRendererCapabilities: mock(),
  prewarmMicrophone: mock(),
  resetAudioPool: mock(),
};

function createMockLocation(href) {
  const url = new URL(href);
  return {
    get href() {
      return url.href;
    },
    set href(value) {
      url.href = new URL(value, url.href).href;
    },
    get search() {
      return url.search;
    },
    set search(value) {
      url.search = value;
    },
    get origin() {
      return url.origin;
    },
  };
}

function createMockHistory(locationObject) {
  return {
    pushState: (_state, _title, nextUrl) => {
      const targetUrl =
        typeof nextUrl === 'string'
          ? new URL(nextUrl, locationObject.href)
          : nextUrl;
      locationObject.href = targetUrl.href;
    },
  };
}

const defaultToys = [
  {
    slug: 'brand',
    title: 'Test Brand Toy',
    module: './__mocks__/fake-module.js',
    type: 'module',
    requiresWebGPU: false,
  },
];

async function buildLoader({
  toys = defaultToys,
  locationHref = 'http://example.com/library',
  manifestPath = './__mocks__/fake-module.js',
  ensureWebGLCheck = () => true,
  rendererCapabilities = capabilitiesMock.getRendererCapabilities,
  prewarmRendererCapabilities = servicesMock.prewarmRendererCapabilities,
  prewarmMicrophone = servicesMock.prewarmMicrophone,
  resetAudioPool = servicesMock.resetAudioPool,
} = {}) {
  const location = createMockLocation(locationHref);

  Object.defineProperty(window, 'location', {
    writable: true,
    configurable: true,
    value: location,
  });
  Object.defineProperty(window, 'history', {
    writable: true,
    configurable: true,
    value: createMockHistory(location),
  });

  const manifestClient = { resolveModulePath: mock(() => manifestPath) };
  const router = createRouter({ windowRef: () => window, queryParam: 'toy' });
  const view = createToyView({ documentRef: () => document });
  // Bust module cache in case other specs mocked the loader exports.
  const { createLoader } = await import(
    `../assets/js/loader.ts?t=${Date.now()}`
  );

  const loader = createLoader({
    manifestClient,
    router,
    view,
    ensureWebGLCheck,
    rendererCapabilities,
    toys,
    prewarmRendererCapabilitiesFn: prewarmRendererCapabilities,
    prewarmMicrophoneFn: prewarmMicrophone,
    resetAudioPoolFn: resetAudioPool,
  });

  return { loader, manifestClient, router, view, location };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="toy-list"></div>';
  capabilitiesMock = {
    getRendererCapabilities: mock(async () => defaultCapabilities),
    rememberRendererFallback: mock(),
    resetRendererCapabilities: mock(),
    getCachedRendererCapabilities: mock(() => defaultCapabilities),
  };
  servicesMock.prewarmRendererCapabilities.mockReset();
  servicesMock.prewarmMicrophone.mockReset();
  servicesMock.resetAudioPool.mockReset();
});

afterEach(() => {
  mock.restore();
  document.body.innerHTML = '';
  defaultToyLifecycle.reset();
  Object.defineProperty(window, 'location', {
    writable: true,
    configurable: true,
    value: originalLocation,
  });
  Object.defineProperty(window, 'history', {
    writable: true,
    configurable: true,
    value: originalHistory,
  });
  Object.defineProperty(global, 'navigator', {
    writable: true,
    configurable: true,
    value: originalNavigator,
  });
});

describe('loadToy', () => {
  test('loads module toy without mutating history when pushState is false', async () => {
    const { loader, manifestClient } = await buildLoader();

    await loader.loadToy('brand');

    expect(document.querySelector('[data-fake-toy]')).not.toBeNull();
    expect(manifestClient.resolveModulePath).toHaveBeenCalledWith(
      './__mocks__/fake-module.js'
    );
    expect(window.location.search).toBe('');
  });

  test('renders and wires a Back to Library control', async () => {
    const { loader } = await buildLoader({
      locationHref: 'http://example.com/library',
    });

    await loader.loadToy('brand', { pushState: true });

    const backControl = document.querySelector('[data-back-to-library]');
    expect(backControl).not.toBeNull();
    expect(window.location.search).toBe('?toy=brand');

    backControl?.dispatchEvent(new Event('click', { bubbles: true }));

    expect(defaultToyLifecycle.getActiveToy()).toBeNull();
    expect(
      document.getElementById('toy-list')?.classList.contains('is-hidden')
    ).toBe(false);
    expect(window.location.search).toBe('');
    expect(servicesMock.resetAudioPool).toHaveBeenCalled();
  });
});

describe('WebGPU requirements', () => {
  test('shows capability error instead of loading module toy', async () => {
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: {},
    });

    capabilitiesMock.getRendererCapabilities.mockResolvedValue({
      preferredBackend: 'webgl',
      adapter: null,
      device: null,
      triedWebGPU: false,
      fallbackReason: 'WebGPU unavailable',
      shouldRetryWebGPU: false,
    });

    const { loader } = await buildLoader({
      toys: [
        {
          slug: 'webgpu-toy',
          title: 'Fancy WebGPU',
          module: './__mocks__/fake-module.js',
          type: 'module',
          requiresWebGPU: true,
          allowWebGLFallback: false,
        },
      ],
    });

    await loader.loadToy('webgpu-toy', { pushState: true });

    const status = document.querySelector('.active-toy-status.is-error');
    expect(status?.querySelector('h2')?.textContent).toContain(
      'WebGPU not available'
    );
    expect(window.location.search).toBe('');
  });

  test('continues when WebGL fallback is allowed', async () => {
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: {},
    });

    capabilitiesMock.getRendererCapabilities.mockResolvedValue({
      preferredBackend: 'webgl',
      adapter: null,
      device: null,
      triedWebGPU: false,
      fallbackReason: 'WebGPU unavailable',
      shouldRetryWebGPU: false,
    });

    const { loader } = await buildLoader({
      toys: [
        {
          slug: 'webgpu-toy',
          title: 'Fancy WebGPU',
          module: './__mocks__/fake-module.js',
          type: 'module',
          requiresWebGPU: true,
          allowWebGLFallback: true,
        },
      ],
    });

    await loader.loadToy('webgpu-toy');

    const continueButton = document.querySelector(
      '.active-toy-actions .cta-button.primary'
    );
    expect(continueButton).not.toBeNull();

    continueButton?.dispatchEvent(new Event('click', { bubbles: true }));

    // eslint-disable-next-line no-undef
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('[data-fake-toy]')).not.toBeNull();
    expect(document.querySelector('.active-toy-status')).toBeNull();
  });

  test('consults shared renderer capabilities before gating WebGPU toys', async () => {
    capabilitiesMock.getRendererCapabilities.mockResolvedValue({
      preferredBackend: 'webgl',
      adapter: null,
      device: null,
      triedWebGPU: true,
      fallbackReason: 'Cached fallback',
      shouldRetryWebGPU: false,
    });

    const { loader } = await buildLoader({
      toys: [
        {
          slug: 'webgpu-toy',
          title: 'Fancy WebGPU',
          module: './__mocks__/fake-module.js',
          type: 'module',
          requiresWebGPU: true,
          allowWebGLFallback: true,
        },
      ],
    });

    await loader.loadToy('webgpu-toy');

    expect(capabilitiesMock.getRendererCapabilities).toHaveBeenCalledTimes(1);
    const status = document.querySelector('.active-toy-status');
    expect(status?.classList.contains('is-warning')).toBe(true);
  });
});

describe('loadFromQuery routing', () => {
  test('loads from existing query param', async () => {
    const { loader, location } = await buildLoader({
      locationHref: 'http://example.com/library?toy=brand',
    });

    await loader.loadFromQuery();

    expect(document.querySelector('[data-fake-toy]')).not.toBeNull();
    expect(location.search).toBe('?toy=brand');
  });

  test('returns to library when query param is missing', async () => {
    const { loader } = await buildLoader({
      locationHref: 'http://example.com/library',
    });

    await loader.loadFromQuery();

    expect(
      document.getElementById('toy-list')?.classList.contains('is-hidden')
    ).toBe(false);
    const activeContainer = document.querySelector('.active-toy-container');
    expect(
      !activeContainer || activeContainer.classList.contains('is-hidden')
    ).toBe(true);
  });
});
