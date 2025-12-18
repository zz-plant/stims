import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';

const loaderModule = '../assets/js/loader.js';
const originalWindow = global.window;
const originalLocation = window.location;
const originalHistory = window.history;
const originalNavigator = global.navigator;
const createManagerMock = () => {
  const state = { activeToy: null };
  return {
    get activeToy() {
      return state.activeToy;
    },
    set activeToy(value) {
      state.activeToy = value;
    },
    disposeActiveToy: mock(() => {
      state.activeToy?.dispose?.();
      state.activeToy = null;
    }),
    getActiveToy: mock(() => state.activeToy),
    setActiveToy: mock((toy) => {
      state.activeToy = toy ?? null;
      return state.activeToy;
    }),
  };
};
let managerMock = createManagerMock();

const freshImport = async (path) => import(`${path}?t=${Date.now()}-${Math.random()}`);
const resetManagerMock = () => {
  managerMock = createManagerMock();
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
      const targetUrl = typeof nextUrl === 'string' ? new URL(nextUrl, locationObject.href) : nextUrl;
      locationObject.href = targetUrl.href;
    },
  };
}

describe('loadToy', () => {
  let loadToy;

  beforeEach(async () => {
    mock.restore();
    resetManagerMock();
    global.fetch = mock(() =>
      Promise.resolve({
        json: () => Promise.resolve([{ slug: 'brand', module: './toy.html?toy=brand' }]),
      })
    );
    mock.module('../assets/js/utils/webgl-check.ts', () => ({ ensureWebGL: () => true }));
    mock.module('../assets/js/toys-data.js', () => ({
      default: [
        {
          slug: 'brand',
          title: 'Test Brand Toy',
          module: './__mocks__/fake-module.js',
          type: 'module',
          requiresWebGPU: false,
        },
      ],
    }));
    mock.module('../assets/js/core/toy-manager.ts', () => managerMock);
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
    ({ loadToy } = await freshImport(loaderModule));
  });

  afterEach(() => {
    mock.restore();
    document.body.innerHTML = '';
    resetManagerMock();
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
    expect(managerMock.setActiveToy).toHaveBeenCalled();
    expect(managerMock.activeToy).not.toBeNull();
    expect(window.location.href).toBe('http://example.com/');
  });
});

describe('active toy navigation affordance', () => {
  let loadToy;

  beforeEach(async () => {
    mock.restore();
    resetManagerMock();
    document.body.innerHTML = '<div id="toy-list"></div>';
    global.fetch = mock(() => Promise.resolve({ ok: false }));

    mock.module('../assets/js/utils/webgl-check.ts', () => ({ ensureWebGL: () => true }));
    mock.module('../assets/js/toys-data.js', () => ({
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
    mock.module('../assets/js/core/toy-manager.ts', () => managerMock);

    ({ loadToy } = await freshImport(loaderModule));
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
    mock.restore();
    document.body.innerHTML = '';
    resetManagerMock();
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

  test('renders and wires a Back to Library control', async () => {
    await loadToy('module-toy', { pushState: true });

    const backControl = document.querySelector('[data-back-to-library]');
    expect(backControl).not.toBeNull();

    backControl.click();

    expect(managerMock.disposeActiveToy).toHaveBeenCalled();
    expect(managerMock.activeToy).toBeNull();
    expect(document.getElementById('toy-list')?.classList.contains('is-hidden')).toBe(false);
    expect(window.location.search).toBe('');
  });
});

describe('WebGPU requirements', () => {
  beforeEach(() => {
    mock.restore();
    resetManagerMock();
    document.body.innerHTML = '<div id="toy-list"></div>';
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: {},
    });
    global.fetch = mock(() => Promise.resolve({ ok: false }));
    mock.module('../assets/js/utils/webgl-check.ts', () => ({ ensureWebGL: () => true }));
    mock.module('../assets/js/core/toy-manager.ts', () => managerMock);
  });

  afterEach(() => {
    mock.restore();
    document.body.innerHTML = '';
    resetManagerMock();
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
    mock.module('../assets/js/toys-data.js', () => ({
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

    const { loadToy } = await freshImport(loaderModule);
    await loadToy('webgpu-toy', { pushState: true });

    const status = document.querySelector('.active-toy-status.is-error');
    expect(status?.querySelector('h2')?.textContent).toContain('WebGPU not available');
    expect(window.location.href).toBe(originalLocation.href);
  });
});

describe('resolveModulePath', () => {
  const moduleEntry = 'assets/js/toys/example.ts';

  beforeEach(() => {
    mock.restore();
    global.window = { location: { origin: 'http://example.com' } };
  });

  afterEach(() => {
    mock.restore();
    delete global.fetch;
    global.window = originalWindow;
  });

  test('uses manifest entry when available', async () => {
    const manifest = {
      [moduleEntry]: { file: 'assets/js/toys/example.123.js' },
    };
    global.fetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) }));

    const { resolveModulePath } = await freshImport(loaderModule);
    const modulePath = await resolveModulePath(moduleEntry);

    expect(global.fetch).toHaveBeenCalled();
    expect(modulePath).toBe('/assets/js/toys/example.123.js');
  });

  test('falls back when manifest is missing', async () => {
    global.fetch = mock(() => Promise.resolve({ ok: false }));

    const { resolveModulePath } = await freshImport(loaderModule);
    const modulePath = await resolveModulePath(moduleEntry);

    expect(modulePath).toBe('/assets/js/toys/example.ts');
  });
});
