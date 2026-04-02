import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { defaultToyLifecycle } from '../assets/js/core/toy-lifecycle.ts';
import { createRouter } from '../assets/js/router.ts';
import { createToyView } from '../assets/js/toy-view.ts';

const originalLocation = window.location;
const originalHistory = window.history;
const originalNavigator = global.navigator;
const fixtureModulePath = '../../tests/fixtures/toy-modules/fake-module.js';
const fixtureGlobalAudioModulePath =
  '../../tests/fixtures/toy-modules/fake-global-audio-module.js';
const fixtureDelayedModulePath =
  '../../tests/fixtures/toy-modules/fake-delayed-module.js';

const defaultCapabilities = {
  preferredBackend: 'webgpu',
  adapter: {},
  device: {},
  fallbackReason: null,
  shouldRetryWebGPU: false,
  forceWebGL: false,
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
    slug: 'milkdrop',
    title: 'Test MilkDrop Visualizer',
    module: fixtureModulePath,
    type: 'module',
    requiresWebGPU: false,
  },
];

async function buildLoader({
  toys = defaultToys,
  locationHref = 'http://example.com/library',
  manifestPath = fixtureModulePath,
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

  const resolveModulePath =
    typeof manifestPath === 'function' ? manifestPath : () => manifestPath;
  const manifestClient = { resolveModulePath: mock(resolveModulePath) };
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
  window.history.replaceState({}, '', '/');
  window.localStorage.clear();
  window.sessionStorage.clear();
  delete document.body.dataset.audioActive;
  delete document.body.dataset.currentToy;
  document.body.innerHTML = '<div id="toy-list"></div>';
  globalThis.HTMLButtonElement = window.HTMLButtonElement;
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

describe('flow cadence helper', () => {
  test('uses the warmup interval for the first flow cycle', async () => {
    const { getFlowIntervalMs } = await import('../assets/js/loader.ts');

    const interval = getFlowIntervalMs({
      cycleCount: 0,
      lastInteractionAt: 1_000,
      now: 10_000,
    });

    expect(interval).toBe(60_000);
  });

  test('uses the engaged interval when recent interaction is detected', async () => {
    const { getFlowIntervalMs } = await import('../assets/js/loader.ts');

    const interval = getFlowIntervalMs({
      cycleCount: 2,
      lastInteractionAt: 100_000,
      now: 180_000,
    });

    expect(interval).toBe(90_000);
  });

  test('uses the idle interval when interaction is stale', async () => {
    const { getFlowIntervalMs } = await import('../assets/js/loader.ts');

    const interval = getFlowIntervalMs({
      cycleCount: 2,
      lastInteractionAt: 100_000,
      now: 240_001,
    });

    expect(interval).toBe(120_000);
  });
});

describe('loadToy', () => {
  test('loads module toy without mutating history when pushState is false', async () => {
    const { loader, manifestClient } = await buildLoader();

    await loader.loadToy('milkdrop');

    expect(document.querySelector('[data-fake-toy]')).not.toBeNull();
    expect(manifestClient.resolveModulePath).toHaveBeenCalledWith(
      fixtureModulePath,
    );
    expect(window.location.search).toBe('');
  });

  test('renders and wires a Back to Library control', async () => {
    const { loader } = await buildLoader({
      locationHref: 'http://example.com/library',
    });

    await loader.loadToy('milkdrop', { pushState: true });

    const backControl = document.querySelector('[data-back-to-library]');
    expect(backControl).not.toBeNull();
    expect(new URL(window.location.href).pathname).toBe('/milkdrop/');
    expect(window.location.search).toBe('');

    backControl?.dispatchEvent(new Event('click', { bubbles: true }));

    expect(defaultToyLifecycle.getActiveToy()).toBeNull();
    expect(
      document.getElementById('toy-list')?.classList.contains('is-hidden'),
    ).toBe(false);
    expect(new URL(window.location.href).pathname).toBe('/');
    expect(window.location.search).toBe('');
    expect(servicesMock.resetAudioPool).toHaveBeenCalled();
  });

  test('keeps render overrides when returning to library outside party mode', async () => {
    window.localStorage.setItem('stims:max-pixel-ratio', '1.3');
    window.localStorage.setItem('stims:render-scale', '0.9');

    const { loader } = await buildLoader({
      locationHref: 'http://example.com/library',
    });

    await loader.loadToy('milkdrop', { pushState: true });

    const backControl = document.querySelector('[data-back-to-library]');
    backControl?.dispatchEvent(new Event('click', { bubbles: true }));

    expect(window.localStorage.getItem('stims:max-pixel-ratio')).toBe('1.3');
    expect(window.localStorage.getItem('stims:render-scale')).toBe('0.9');
  });

  test('enables beat haptics on supported devices and responds to beat events', async () => {
    const vibrate = mock(() => true);
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: {
        ...originalNavigator,
        userAgent: 'iPhone',
        vibrate,
      },
    });

    const { loader } = await buildLoader();
    await loader.loadToy('milkdrop', { pushState: true });

    const hapticsBtn = document.querySelector('[data-haptics-toggle="true"]');
    expect(hapticsBtn).not.toBeNull();

    document.body.dataset.audioActive = 'true';
    hapticsBtn?.dispatchEvent(new Event('click', { bubbles: true }));

    window.dispatchEvent(
      new CustomEvent('stims:audio-beat', {
        detail: { intensity: 0.8 },
      }),
    );

    expect(vibrate).toHaveBeenCalled();
  });

  test('shows the floating audio prompt even when shell controls exist behind the active toy overlay', async () => {
    document.body.innerHTML =
      '<div id="toy-list"></div><div data-audio-controls><div data-existing="true"></div></div>';

    const { loader } = await buildLoader({
      toys: [
        {
          slug: 'audio-toy',
          title: 'Audio Toy',
          module: fixtureGlobalAudioModulePath,
          type: 'module',
          requiresWebGPU: false,
        },
      ],
      manifestPath: (modulePath) => modulePath,
    });

    await loader.loadToy('audio-toy');

    expect(
      document.querySelector('#active-toy-container .control-panel'),
    ).not.toBeNull();
  });

  test('suppresses the floating audio prompt when shell audio startup is already in flight', async () => {
    document.body.innerHTML = `
      <div id="toy-list"></div>
      <div data-audio-controls>
        <button type="button" data-loading aria-busy="true">Starting…</button>
      </div>
    `;

    const { loader } = await buildLoader({
      toys: [
        {
          slug: 'audio-toy',
          title: 'Audio Toy',
          module: fixtureGlobalAudioModulePath,
          type: 'module',
          requiresWebGPU: false,
        },
      ],
      manifestPath: (modulePath) => modulePath,
    });

    await loader.loadToy('audio-toy');

    expect(
      document.querySelector('#active-toy-container .control-panel'),
    ).toBeNull();
  });

  test('keeps the current toy mounted while the next toy is loading', async () => {
    const { loader } = await buildLoader({
      toys: [
        {
          slug: 'first-toy',
          title: 'First Toy',
          module: fixtureModulePath,
          type: 'module',
          requiresWebGPU: false,
        },
        {
          slug: 'second-toy',
          title: 'Second Toy',
          module: fixtureDelayedModulePath,
          type: 'module',
          requiresWebGPU: false,
        },
      ],
      manifestPath: (modulePath) => modulePath,
    });

    await loader.loadToy('first-toy', { pushState: true });
    const firstToyNode = document.querySelector('[data-fake-toy]');
    expect(firstToyNode).not.toBeNull();

    const transition = loader.loadToy('second-toy', { pushState: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(firstToyNode?.isConnected).toBe(true);

    await transition;

    expect(firstToyNode?.isConnected).toBe(false);
    expect(
      document.querySelector('[data-fake-toy="second-toy"]'),
    ).not.toBeNull();
    expect(document.querySelectorAll('[data-fake-toy]')).toHaveLength(1);
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
      fallbackReason: 'WebGPU unavailable',
      shouldRetryWebGPU: false,
      forceWebGL: false,
    });

    const { loader } = await buildLoader({
      toys: [
        {
          slug: 'webgpu-toy',
          title: 'Fancy WebGPU',
          module: fixtureModulePath,
          type: 'module',
          requiresWebGPU: true,
          allowWebGLFallback: false,
        },
      ],
    });

    await loader.loadToy('webgpu-toy', { pushState: true });

    const status = document.querySelector('.active-toy-status.is-error');
    expect(status?.querySelector('h2')?.textContent).toContain(
      'WebGPU not available',
    );
    expect(window.location.search).toBe('');
  });

  test('loads immediately when WebGL fallback is allowed', async () => {
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: {},
    });

    capabilitiesMock.getRendererCapabilities.mockResolvedValue({
      preferredBackend: 'webgl',
      adapter: null,
      device: null,
      fallbackReason: 'WebGPU unavailable',
      shouldRetryWebGPU: false,
      forceWebGL: false,
    });

    const { loader } = await buildLoader({
      toys: [
        {
          slug: 'webgpu-toy',
          title: 'Fancy WebGPU',
          module: fixtureModulePath,
          type: 'module',
          requiresWebGPU: true,
          allowWebGLFallback: true,
        },
      ],
    });

    await loader.loadToy('webgpu-toy');

    expect(document.querySelector('[data-fake-toy]')).not.toBeNull();
    expect(document.querySelector('.active-toy-status')).toBeNull();
  });

  test('consults shared renderer capabilities before gating WebGPU toys', async () => {
    capabilitiesMock.getRendererCapabilities.mockResolvedValue({
      preferredBackend: 'webgl',
      adapter: null,
      device: null,
      fallbackReason: 'Cached fallback',
      shouldRetryWebGPU: false,
      forceWebGL: false,
    });

    const { loader } = await buildLoader({
      toys: [
        {
          slug: 'webgpu-toy',
          title: 'Fancy WebGPU',
          module: fixtureModulePath,
          type: 'module',
          requiresWebGPU: true,
          allowWebGLFallback: true,
        },
      ],
    });

    await loader.loadToy('webgpu-toy');

    expect(capabilitiesMock.getRendererCapabilities).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-fake-toy]')).not.toBeNull();
    expect(document.querySelector('.active-toy-status')).toBeNull();
  });

  test('can retry WebGPU when probing failed on a supported device', async () => {
    capabilitiesMock.getRendererCapabilities
      .mockResolvedValueOnce({
        preferredBackend: 'webgl',
        adapter: null,
        device: null,
        fallbackReason: 'Unable to acquire a WebGPU device.',
        shouldRetryWebGPU: true,
        forceWebGL: false,
      })
      .mockResolvedValueOnce(defaultCapabilities);

    const { loader } = await buildLoader({
      toys: [
        {
          slug: 'webgpu-toy',
          title: 'Fancy WebGPU',
          module: fixtureModulePath,
          type: 'module',
          requiresWebGPU: true,
          allowWebGLFallback: true,
        },
      ],
    });

    await loader.loadToy('webgpu-toy');

    expect(document.querySelector('[data-fake-toy]')).not.toBeNull();
    const retryWebGPUButton = document.querySelector('.renderer-pill__retry');
    expect(retryWebGPUButton?.textContent).toContain('Try WebGPU');

    retryWebGPUButton?.dispatchEvent(new Event('click', { bubbles: true }));
    // eslint-disable-next-line no-undef
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(capabilitiesMock.getRendererCapabilities).toHaveBeenNthCalledWith(
      2,
      {
        forceRetry: true,
        preferWebGLForKnownCompatibilityGaps: false,
      },
    );
    expect(document.querySelector('[data-fake-toy]')).not.toBeNull();
  });

  test('can disable compatibility mode and retry with WebGPU', async () => {
    capabilitiesMock.getRendererCapabilities
      .mockResolvedValueOnce({
        preferredBackend: 'webgl',
        adapter: null,
        device: null,
        fallbackReason: 'Compatibility mode is enabled. Using WebGL.',
        shouldRetryWebGPU: false,
        forceWebGL: true,
      })
      .mockResolvedValueOnce(defaultCapabilities);

    window.localStorage.setItem('stims:compatibility-mode', 'true');

    const { loader } = await buildLoader({
      toys: [
        {
          slug: 'webgpu-toy',
          title: 'Fancy WebGPU',
          module: fixtureModulePath,
          type: 'module',
          requiresWebGPU: true,
          allowWebGLFallback: true,
        },
      ],
    });

    await loader.loadToy('webgpu-toy');

    expect(document.querySelector('[data-fake-toy]')).not.toBeNull();
    const useWebGPUButton = document.querySelector('.renderer-pill__retry');
    expect(useWebGPUButton?.textContent).toContain('Use WebGPU');

    useWebGPUButton?.dispatchEvent(new Event('click', { bubbles: true }));
    // eslint-disable-next-line no-undef
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.localStorage.getItem('stims:compatibility-mode')).toBe(
      'false',
    );
    expect(capabilitiesMock.getRendererCapabilities).toHaveBeenNthCalledWith(
      2,
      {
        forceRetry: true,
        preferWebGLForKnownCompatibilityGaps: false,
      },
    );
    expect(document.querySelector('[data-fake-toy]')).not.toBeNull();
  });
});

describe('loadFromQuery routing', () => {
  test('loads from existing query param', async () => {
    const { loader, location } = await buildLoader({
      locationHref: 'http://example.com/milkdrop/',
    });

    await loader.loadFromQuery();

    expect(document.querySelector('[data-fake-toy]')).not.toBeNull();
    expect(new URL(location.href).pathname).toBe('/milkdrop/');
    expect(location.search).toBe('');
  });

  test('returns to library when query param is missing', async () => {
    const { loader } = await buildLoader({
      locationHref: 'http://example.com/library',
    });

    await loader.loadFromQuery();

    expect(
      document.getElementById('toy-list')?.classList.contains('is-hidden'),
    ).toBe(false);
    const activeContainer = document.querySelector('.active-toy-container');
    expect(
      !activeContainer || activeContainer.classList.contains('is-hidden'),
    ).toBe(true);
  });
});
