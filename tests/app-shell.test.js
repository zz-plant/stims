import { jest } from '@jest/globals';

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
    slug: 'brand',
    title: 'Star Guitar Visualizer',
    description: 'A music video inspired visualizer.',
    module: './brand.html',
    type: 'page',
    requiresWebGPU: false,
  },
  {
    slug: 'words',
    title: 'Interactive Word Cloud',
    description: 'Speak and watch the cloud shift.',
    module: './words.html',
    type: 'page',
    requiresWebGPU: false,
  },
];

let mockLoadToy;
let mockLoadFromQuery;
let mockInitNavigation;

async function loadAppShell() {
  jest.unstable_mockModule('../assets/js/loader.js', () => ({
    initNavigation: mockInitNavigation,
    loadToy: mockLoadToy,
    loadFromQuery: mockLoadFromQuery,
  }));

  jest.unstable_mockModule('../assets/js/toys-data.js', () => ({
    default: toyLibrary,
  }));

  await import('../assets/js/app-shell.js');
}

describe('app shell user journeys', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<input id="search-bar" /><div id="toy-list"></div>';
    mockLoadToy = jest.fn();
    mockLoadFromQuery = jest.fn();
    mockInitNavigation = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    document.body.innerHTML = '';
    window.location = originalLocation;
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
    search.value = 'cloud';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const visibleTitles = Array.from(
      document.querySelectorAll('.webtoy-card h3')
    ).map((node) => node.textContent);

    expect(visibleTitles).toEqual(['Interactive Word Cloud']);
  });

  test('launching toys routes module entries and navigates for HTML pages', async () => {
    const mockLocation = { href: 'http://example.com/library' };
    Object.defineProperty(window, 'location', { value: mockLocation, writable: true });

    await loadAppShell();

    const cards = document.querySelectorAll('.webtoy-card');
    cards[0].dispatchEvent(new Event('click', { bubbles: true }));
    expect(mockLoadToy).toHaveBeenCalledWith('aurora-painter', { pushState: true });

    cards[1].dispatchEvent(new Event('click', { bubbles: true }));
    expect(window.location.href).toBe('./brand.html');
  });
});
