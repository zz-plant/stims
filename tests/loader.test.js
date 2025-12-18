import { jest } from '@jest/globals';

const loaderModule = '../assets/js/loader.js';
const originalLocation = window.location;
const originalHistory = window.history;
const originalNavigator = global.navigator;

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

describe('loadToy', () => {
  let loadToy;

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = '<div id="toy-list"></div>';
    global.fetch = jest.fn(() => Promise.resolve({ ok: false }));
    const location = createMockLocation('http://example.com');
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
    await jest.unstable_mockModule('../assets/js/toys-data.js', () => ({
      default: [
        {
          slug: 'brand',
          module: './__mocks__/fake-module.js',
          type: 'module',
          requiresWebGPU: false,
        },
      ],
    }));

    ({ loadToy } = await import(loaderModule));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    document.body.innerHTML = '';
    delete global.fetch;
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: originalNavigator,
    });
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
  });

  test('loads module toy without navigation', async () => {
    await loadToy('brand');
    expect(document.querySelector('[data-fake-toy]')).not.toBeNull();
    expect(window.location.href).toBe('http://example.com/');
  });
});

describe('active toy navigation affordance', () => {
  let loadToy;

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = '<div id="toy-list"></div>';
    global.fetch = jest.fn(() => Promise.resolve({ ok: false }));

    await jest.unstable_mockModule('../assets/js/toys-data.js', () => ({
      default: [
        {
          slug: 'module-toy',
          title: 'Module Test',
          module: './__mocks__/fake-module.js',
          type: 'module',
          requiresWebGPU: false,
        },
      ],
    }));

    ({ loadToy } = await import(loaderModule));
    const location = createMockLocation('http://example.com/library');
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
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    document.body.innerHTML = '';
    delete global.fetch;
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: originalNavigator,
    });
    delete globalThis.__activeWebToy;
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
  });

  test('renders and wires a Back to Library control', async () => {
    await loadToy('module-toy', { pushState: true });

    const backControl = document.querySelector('[data-back-to-library]');
    expect(backControl).not.toBeNull();

    globalThis.__activeWebToy = { dispose: jest.fn() };

    backControl.click();

    expect(globalThis.__activeWebToy).toBeUndefined();
    expect(document.getElementById('toy-list')?.classList.contains('is-hidden')).toBe(
      false
    );
    expect(window.location.search).toBe('');
  });
});

describe('WebGPU requirements', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="toy-list"></div>';
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: {},
    });
    global.fetch = jest.fn(() => Promise.resolve({ ok: false }));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    document.body.innerHTML = '';
    delete global.fetch;
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: originalNavigator,
    });
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
  });

  test('shows capability error instead of loading module toy', async () => {
    await jest.unstable_mockModule('../assets/js/toys-data.js', () => ({
      default: [
        {
          slug: 'webgpu-toy',
          title: 'Fancy WebGPU',
          module: 'assets/js/toys/example.ts',
          type: 'module',
          requiresWebGPU: true,
        },
      ],
    }));

    const { loadToy } = await import(loaderModule);
    await loadToy('webgpu-toy', { pushState: true });

    const status = document.querySelector('.active-toy-status.is-error');
    expect(status?.querySelector('h2')?.textContent).toContain('WebGPU not available');
    expect(window.location.href).toBe(originalLocation.href);
  });
});

describe('resolveModulePath', () => {
  const moduleEntry = 'assets/js/toys/example.ts';

  beforeEach(() => {
    jest.resetModules();
    global.window = { location: { origin: 'http://example.com' } };
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    delete global.fetch;
    delete global.window;
  });

  test('uses manifest entry when available', async () => {
    const manifest = {
      [moduleEntry]: { file: 'assets/js/toys/example.123.js' },
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) })
    );

    const { resolveModulePath } = await import(loaderModule);
    const modulePath = await resolveModulePath(moduleEntry);

    expect(global.fetch).toHaveBeenCalledWith('/.vite/manifest.json');
    expect(modulePath).toBe('/assets/js/toys/example.123.js');
  });

  test('falls back when manifest is missing', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false }));

    const { resolveModulePath } = await import(loaderModule);
    const modulePath = await resolveModulePath(moduleEntry);

    expect(modulePath).toBe('/assets/js/toys/example.ts');
  });
});
