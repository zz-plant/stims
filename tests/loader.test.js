/** @jest-environment node */
import { jest } from '@jest/globals';

const loaderModule = '../assets/js/loader.js';

describe('loadToy', () => {
  let loadToy;

  beforeEach(async () => {
    jest.resetModules();
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([{ slug: 'brand', module: './toy.html?toy=brand' }]),
      })
    );
    global.window = { location: { href: '' } };
    ({ loadToy } = await import(loaderModule));
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.fetch;
    delete global.window;
  });

  test('navigates to HTML toy page', async () => {
    await loadToy('brand');
    expect(window.location.href).toBe('./brand.html');
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
