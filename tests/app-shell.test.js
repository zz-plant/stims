import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const freshImport = async (path) =>
  import(`${path}?t=${Date.now()}-${Math.random()}`);

let mockLoadToy;
let mockLoadFromQuery;
let mockInitNavigation;

async function loadAppShell() {
  globalThis.__stimsLoaderOverrides = {
    initNavigation: mockInitNavigation,
    loadToy: mockLoadToy,
    loadFromQuery: mockLoadFromQuery,
  };

  await freshImport('../assets/js/app.ts');
  await globalThis.__stimsAppReady;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('home shell user journeys', () => {
  beforeEach(() => {
    mock.restore();
    window.location.href = 'https://example.com/';
    document.body.innerHTML = `
      <div data-top-nav-container></div>
      <a href="/milkdrop/?audio=demo&panel=browse&collection=cream-of-the-crop" data-quickstart-slug="milkdrop">Launch</a>
      <div data-milkdrop-preset-count></div>
      <div data-milkdrop-preset-filters></div>
      <div data-milkdrop-preset-list></div>
    `;
    document.body.dataset.page = 'home';
    mockLoadToy = mock(async () => {});
    mockLoadFromQuery = mock();
    mockInitNavigation = mock();
  });

  afterEach(() => {
    mock.restore();
    document.body.innerHTML = '';
    document.body.removeAttribute('data-page');
    delete globalThis.__stimsLoaderOverrides;
  });

  test('home landing redirects straight to the canonical demo launch route', async () => {
    await loadAppShell();

    const currentUrl = new URL(window.location.href);
    expect(currentUrl.pathname).toBe('/milkdrop/');
    expect(currentUrl.searchParams.get('audio')).toBe('demo');
    expect(currentUrl.searchParams.get('panel')).toBe('browse');
    expect(currentUrl.searchParams.get('collection')).toBe('cream-of-the-crop');
    expect(mockInitNavigation).not.toHaveBeenCalled();
    expect(mockLoadToy).not.toHaveBeenCalled();
  });

  test('landing opt-out keeps the homepage session boot in place', async () => {
    window.location.href = 'https://example.com/?landing=1';

    await loadAppShell();

    expect(mockInitNavigation).toHaveBeenCalledTimes(1);
    expect(mockLoadToy).toHaveBeenCalledTimes(1);
    expect(mockLoadToy).toHaveBeenCalledWith('milkdrop', {
      preferDemoAudio: true,
    });
    expect(new URL(window.location.href).pathname).toBe('/');
    expect(new URL(window.location.href).searchParams.get('landing')).toBe('1');
    expect(mockLoadFromQuery).not.toHaveBeenCalled();
  });

  test('homepage quickstart stays a native navigation instead of SPA-loading in place', async () => {
    window.location.href = 'https://example.com/?landing=1';

    await loadAppShell();

    const cta = document.querySelector('[data-quickstart-slug="milkdrop"]');
    expect(cta).not.toBeNull();

    cta?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(mockLoadToy).toHaveBeenCalledTimes(1);
  });
});
