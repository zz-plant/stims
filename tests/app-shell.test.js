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
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('home shell user journeys', () => {
  beforeEach(() => {
    mock.restore();
    window.location.href = 'https://example.com/';
    document.body.innerHTML = `
      <div data-top-nav-container></div>
      <a href="toy.html?toy=milkdrop" data-quickstart-slug="milkdrop">Launch</a>
      <div data-milkdrop-preset-count></div>
      <div data-milkdrop-preset-filters></div>
      <div data-milkdrop-preset-list></div>
      <section id="system-check"></section>
      <div data-readiness-panel></div>
      <div data-system-controls></div>
      <a href="#system-check" data-scroll-to-system-check>See device setup</a>
      <button type="button" data-details-toggle aria-expanded="false">
        <span data-details-label="open">More details</span>
        <span data-details-label="close">Less details</span>
      </button>
    `;
    document.body.dataset.page = 'home';
    mockLoadToy = mock();
    mockLoadFromQuery = mock();
    mockInitNavigation = mock();
  });

  afterEach(() => {
    mock.restore();
    document.body.innerHTML = '';
    document.body.removeAttribute('data-page');
    delete globalThis.__stimsLoaderOverrides;
  });

  test('home landing renders site navigation without query-driven toy loading', async () => {
    await loadAppShell();

    expect(document.querySelector('[data-top-nav]')).not.toBeNull();
    expect(
      document.querySelector('.nav-link[href="#system-check"]'),
    ).not.toBeNull();
    expect(mockLoadFromQuery).not.toHaveBeenCalled();
  });

  test('homepage quickstart stays a native navigation instead of SPA-loading in place', async () => {
    await loadAppShell();

    const cta = document.querySelector('[data-quickstart-slug="milkdrop"]');
    expect(cta).not.toBeNull();

    cta?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(mockLoadToy).not.toHaveBeenCalled();
  });
});
