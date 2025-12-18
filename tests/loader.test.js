import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';

import { createLoader } from '../assets/js/loader.js';

const fakeModulePath = new URL('../assets/js/__mocks__/fake-module.js', import.meta.url).pathname;

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

function createMockWindow(href) {
  const listeners = {};
  const location = createMockLocation(href);
  return {
    location,
    history: createMockHistory(location),
    navigator: {},
    addEventListener: (type, callback) => {
      listeners[type] = callback;
    },
    trigger: (type) => listeners[type]?.(),
  };
}

function createTestDocument() {
  const doc = document.implementation.createHTMLDocument('loader');
  const toyList = doc.createElement('div');
  toyList.id = 'toy-list';
  doc.body.appendChild(toyList);
  return { doc, toyList };
}

describe('createLoader', () => {
  const originalDocument = global.document;
  const originalWindow = global.window;
  let doc;
  let toyList;
  let win;

  beforeEach(() => {
    mock.restore();
    ({ doc, toyList } = createTestDocument());
    win = createMockWindow('http://example.com/library');
    global.document = doc;
    global.window = win;
  });

  afterEach(() => {
    mock.restore();
    global.document = originalDocument;
    global.window = originalWindow;
    delete globalThis.__activeWebToy;
  });

  test('loads a module toy without altering navigation by default', async () => {
    const manifestClient = { resolveModulePath: () => Promise.resolve(fakeModulePath) };
    const loader = createLoader({
      toys: [
        {
          slug: 'brand',
          title: 'Test Brand Toy',
          module: './__mocks__/fake-module.js',
          type: 'module',
          requiresWebGPU: false,
        },
      ],
      manifestClient,
      ensureWebGLCheck: () => true,
      window: win,
      document: doc,
      host: doc.body,
      toyList,
    });

    await loader.loadToy('brand');

    expect(doc.querySelector('[data-fake-toy]')).not.toBeNull();
    expect(win.location.href).toBe('http://example.com/library');
  });

  test('renders and wires a Back to Library control', async () => {
    const manifestClient = { resolveModulePath: () => Promise.resolve(fakeModulePath) };
    const loader = createLoader({
      toys: [
        {
          slug: 'module-toy',
          title: 'Module Test',
          module: './__mocks__/fake-module.js',
          type: 'module',
          requiresWebGPU: false,
        },
      ],
      manifestClient,
      ensureWebGLCheck: () => true,
      window: win,
      document: doc,
      host: doc.body,
      toyList,
    });

    await loader.loadToy('module-toy', { pushState: true });

    const backControl = doc.querySelector('[data-back-to-library]');
    expect(backControl).not.toBeNull();
    expect(win.location.search).toBe('?toy=module-toy');

    backControl?.dispatchEvent(new Event('click', { bubbles: true }));

    expect(globalThis.__activeWebToy).toBeUndefined();
    expect(toyList.classList.contains('is-hidden')).toBe(false);
    expect(win.location.search).toBe('');
  });

  test('shows capability error instead of loading a WebGPU-only toy when unsupported', async () => {
    const manifestClient = { resolveModulePath: () => Promise.resolve(fakeModulePath) };
    const loader = createLoader({
      toys: [
        {
          slug: 'webgpu-toy',
          title: 'Fancy WebGPU',
          module: './__mocks__/fake-module.js',
          type: 'module',
          requiresWebGPU: true,
        },
      ],
      manifestClient,
      ensureWebGLCheck: () => true,
      window: win,
      document: doc,
      host: doc.body,
      toyList,
    });

    await loader.loadToy('webgpu-toy', { pushState: true });

    const status = doc.querySelector('.active-toy-status.is-error');
    expect(status?.querySelector('h2')?.textContent).toContain('WebGPU not available');
    expect(win.location.search).toBe('?toy=webgpu-toy');
  });
});
