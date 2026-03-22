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
      <a href="/milkdrop/?audio=demo" data-quickstart-slug="milkdrop">Launch</a>
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

  test('home landing starts the milkdrop visualizer in place with demo audio preference', async () => {
    await loadAppShell();

    expect(mockInitNavigation).toHaveBeenCalledTimes(1);
    expect(mockLoadToy).toHaveBeenCalledTimes(1);
    expect(mockLoadToy).toHaveBeenCalledWith('milkdrop', {
      preferDemoAudio: true,
    });
    expect(new URL(window.location.href).pathname).toBe('/');
    expect(mockLoadFromQuery).not.toHaveBeenCalled();
  });

  test('homepage quickstart stays a native navigation instead of SPA-loading in place', async () => {
    await loadAppShell();

    const cta = document.querySelector('[data-quickstart-slug="milkdrop"]');
    expect(cta).not.toBeNull();

    cta?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(mockLoadToy).toHaveBeenCalledTimes(1);
  });
});
