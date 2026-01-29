import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const toyLibrary = [
  {
    slug: 'aurora-painter',
    title: 'Aurora Painter',
    description: 'Flowing auroras that react to your mic.',
    module: 'assets/js/toys/aurora-painter.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'evol',
    title: 'Evolutionary Weirdcore',
    description: 'Surreal landscapes that morph with music.',
    module: './evol.html',
    type: 'page',
    requiresWebGPU: false,
  },
];

const freshImport = async (path) =>
  import(`${path}?t=${Date.now()}-${Math.random()}`);

let mockLoadToy;
let mockLoadFromQuery;
let mockInitNavigation;

async function loadAppShell() {
  globalThis.__stimsToyLibrary = toyLibrary;
  globalThis.__stimsLoaderOverrides = {
    initNavigation: mockInitNavigation,
    loadToy: mockLoadToy,
    loadFromQuery: mockLoadFromQuery,
  };

  await freshImport('../assets/js/app-shell.js');
}

describe('app shell user journeys', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    mock.restore();
    document.body.innerHTML =
      '<input id="search-bar" /><div id="toy-list"></div>';
    mockLoadToy = mock();
    mockLoadFromQuery = mock();
    mockInitNavigation = mock();
  });

  afterEach(() => {
    mock.restore();
    document.body.innerHTML = '';
    window.location = originalLocation;
    delete globalThis.__stimsToyLibrary;
    delete globalThis.__stimsLoaderOverrides;
  });

  test('library landing renders cards and kicks off query-based loading', async () => {
    await loadAppShell();

    const cards = document.querySelectorAll('.webtoy-card');
    expect(cards).toHaveLength(toyLibrary.length);
    expect(mockInitNavigation).toHaveBeenCalledTimes(1);
    expect(mockLoadFromQuery).toHaveBeenCalledTimes(1);
  });

  test('searching filters the visible toys by title or description', async () => {
    await loadAppShell();

    const search = document.getElementById('search-bar');
    search.value = 'weirdcore';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const visibleTitles = Array.from(
      document.querySelectorAll('.webtoy-card h3'),
    ).map((node) => node.textContent);

    expect(visibleTitles).toEqual(['Evolutionary Weirdcore']);
  });

  test('launching toys routes module entries and navigates for HTML pages', async () => {
    const mockLocation = { href: 'http://example.com/library' };
    Object.defineProperty(window, 'location', {
      value: mockLocation,
      writable: true,
    });

    await loadAppShell();

    const cards = Array.from(document.querySelectorAll('.webtoy-card'));
    const moduleCard = cards.find(
      (card) => card.querySelector('h3')?.textContent === 'Aurora Painter',
    );
    expect(moduleCard).not.toBeNull();

    const pageCard = cards.find(
      (card) =>
        card.querySelector('h3')?.textContent === 'Evolutionary Weirdcore',
    );
    expect(pageCard).not.toBeNull();
    pageCard?.click();
    expect(window.location.href).toBe('./evol.html');
  });
});
