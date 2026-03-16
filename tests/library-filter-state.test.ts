import { beforeEach, describe, expect, test } from 'bun:test';

import { createLibraryView } from '../assets/js/library-view.js';

const toys = [
  {
    slug: 'calm-flow',
    title: 'Calm Flow',
    description: 'Soft visuals for calm sessions.',
    module: 'assets/js/toys/calm-flow.ts',
    type: 'module',
    requiresWebGPU: false,
    moods: ['calming'],
    capabilities: {
      demoAudio: true,
      microphone: true,
      motion: false,
    },
  },
  {
    slug: 'tilt-wave',
    title: 'Tilt Wave',
    description: 'Mobile-first visuals driven by device motion.',
    module: 'assets/js/toys/tilt-wave.ts',
    type: 'module',
    requiresWebGPU: false,
    moods: ['energetic'],
    tags: ['mobile', 'motion'],
    capabilities: {
      demoAudio: false,
      microphone: false,
      motion: true,
    },
  },
];

describe('library filter state normalization', () => {
  beforeEach(() => {
    window.location.href = 'https://example.com/';
    window.sessionStorage.clear();
    window.localStorage.clear();

    document.body.innerHTML = `
      <p data-search-results></p>
      <div data-active-filters hidden>
        <div data-active-filters-chips></div>
        <button data-active-filters-clear type="button">Clear all</button>
      </div>
      <form data-search-form>
        <input id="toy-search" type="search" />
        <button data-search-clear type="button">Clear</button>
        <datalist id="toy-search-suggestions"></datalist>
      </form>
      <button data-filter-chip data-filter-type="mood" data-filter-value="calming" type="button">Calm</button>
      <button data-filter-reset type="button">Reset</button>
      <select data-sort-control>
        <option value="featured">Featured</option>
      </select>
      <div id="toy-list"></div>
    `;
  });

  test('normalizes legacy mood:calm state to mood:calming so chip toggles correctly', async () => {
    window.sessionStorage.setItem(
      'stims-library-state',
      JSON.stringify({ query: '', filters: ['mood:calm'], sort: 'featured' }),
    );

    const view = createLibraryView({
      toys,
    });

    await view.init();

    const calmChip = document.querySelector('[data-filter-chip]');
    expect(calmChip?.classList.contains('is-active')).toBe(true);

    calmChip?.dispatchEvent(new Event('click', { bubbles: true }));

    const persisted = window.sessionStorage.getItem('stims-library-state');
    expect(persisted).not.toBeNull();
    expect(JSON.parse(persisted ?? '{}').filters).toEqual([]);
    expect(calmChip?.classList.contains('is-active')).toBe(false);
  });
});

test('renders continue panel when returner signals are present', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  window.localStorage.setItem(
    'stims-growth-metrics-v1',
    JSON.stringify({
      activeDays: [yesterday, today],
      toyOpens: 5,
      toyOpenHistory: [
        { slug: 'calm-flow', openedAt: '2026-01-02T00:00:00.000Z' },
      ],
      shares: 0,
      premiumPromptDismissed: false,
    }),
  );

  const view = createLibraryView({
    toys,
  });

  await view.init();

  expect(document.querySelector('.webtoy-growth-panel')).not.toBeNull();
  const openButton = Array.from(document.querySelectorAll('button')).find(
    (button) => (button.textContent ?? '').startsWith('Launch'),
  );
  expect(openButton).toBeTruthy();
});

test('search query filters library cards and persists in the URL', async () => {
  document.body.innerHTML = `
    <p data-search-results></p>
    <div data-active-filters>
      <span data-active-filters-status></span>
      <button data-active-filters-clear type="button">Clear all</button>
    </div>
    <form data-search-form>
      <input id="toy-search" type="search" />
      <button data-search-clear type="button">Clear</button>
      <datalist id="toy-search-suggestions"></datalist>
    </form>
    <button data-filter-reset type="button">Reset</button>
    <select data-sort-control>
      <option value="featured">Featured</option>
    </select>
    <div id="toy-list"></div>
  `;

  const view = createLibraryView({
    toys,
    searchInputId: 'toy-search',
  });

  await view.init();

  const search = document.getElementById('toy-search') as HTMLInputElement;
  search.value = 'mobile';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));

  const cards = Array.from(document.querySelectorAll('.webtoy-card'));
  expect(cards).toHaveLength(1);
  expect(cards[0]?.textContent).toContain('Tilt Wave');
  expect(window.sessionStorage.getItem('stims-library-state')).toContain(
    '"query":"mobile"',
  );
});

test('restores search query from URL state on init', async () => {
  window.location.href = 'https://example.com/?q=mobile';

  const view = createLibraryView({
    toys,
    searchInputId: 'toy-search',
  });

  await view.init();

  const search = document.getElementById('toy-search') as HTMLInputElement;
  expect(search.value).toBe('mobile');

  const cards = Array.from(document.querySelectorAll('.webtoy-card'));
  expect(cards).toHaveLength(1);
  expect(cards[0]?.textContent).toContain('Tilt Wave');
});
