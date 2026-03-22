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
        <span data-active-filters-status></span>
        <div data-active-filters-chips></div>
        <button data-active-filters-clear type="button">Reset view</button>
      </div>
      <form data-search-form>
        <input id="toy-search" type="search" />
        <button data-search-clear type="button">Clear</button>
        <datalist id="toy-search-suggestions"></datalist>
      </form>
      <button data-filter-chip data-filter-type="mood" data-filter-value="calming" type="button">Calm</button>
      <button data-filter-reset type="button">Reset view</button>
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

  test('keeps duplicate quick-filter chips in sync and supports tag filters', async () => {
    document.body.innerHTML = `
      <p data-search-results></p>
      <div data-active-filters>
        <span data-active-filters-status></span>
        <div data-active-filters-chips></div>
        <button data-active-filters-clear type="button">Reset view</button>
      </div>
      <form data-search-form>
        <input id="toy-search" type="search" />
        <button data-search-clear type="button">Clear</button>
        <datalist id="toy-search-suggestions"></datalist>
      </form>
      <div class="quick-filter-strip">
        <button data-filter-chip data-filter-type="tag" data-filter-value="mobile" type="button">Mobile-friendly</button>
      </div>
      <details data-library-refine open>
        <summary>Filters</summary>
        <button data-filter-chip data-filter-type="tag" data-filter-value="mobile" type="button">Mobile</button>
      </details>
      <button data-filter-reset type="button">Reset view</button>
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

    const [quickChip, refineChip] = Array.from(
      document.querySelectorAll('[data-filter-chip]'),
    ) as HTMLButtonElement[];

    quickChip?.dispatchEvent(new Event('click', { bubbles: true }));

    expect(quickChip?.classList.contains('is-active')).toBe(true);
    expect(refineChip?.classList.contains('is-active')).toBe(true);
    expect(document.querySelectorAll('.webtoy-card')).toHaveLength(1);
    expect(document.querySelector('.webtoy-card')?.textContent).toContain(
      'Tilt Wave',
    );

    refineChip?.dispatchEvent(new Event('click', { bubbles: true }));

    expect(quickChip?.classList.contains('is-active')).toBe(false);
    expect(refineChip?.classList.contains('is-active')).toBe(false);
    expect(document.querySelectorAll('.webtoy-card')).toHaveLength(2);
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
  const openButton = document.querySelector('.webtoy-growth-panel button');
  expect(openButton).toBeTruthy();
});

test('search query filters library cards and persists in the URL', async () => {
  document.body.innerHTML = `
    <p data-search-results></p>
    <div data-active-filters>
      <span data-active-filters-status></span>
      <button data-active-filters-clear type="button">Reset view</button>
    </div>
    <form data-search-form>
      <input id="toy-search" type="search" />
      <button data-search-clear type="button">Clear</button>
      <datalist id="toy-search-suggestions"></datalist>
    </form>
    <button data-filter-reset type="button">Reset view</button>
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

test('renders canonical launch hrefs for mapped toys', async () => {
  window.location.href = 'https://example.com/';
  window.sessionStorage.clear();
  window.localStorage.clear();

  document.body.innerHTML = `
    <p data-search-results></p>
    <div data-active-filters>
      <span data-active-filters-status></span>
      <button data-active-filters-clear type="button">Reset view</button>
    </div>
    <form data-search-form>
      <input id="toy-search" type="search" />
      <button data-search-clear type="button">Clear</button>
      <datalist id="toy-search-suggestions"></datalist>
    </form>
    <button data-filter-reset type="button">Reset view</button>
    <select data-sort-control>
      <option value="featured">Featured</option>
    </select>
    <div id="toy-list"></div>
  `;

  const view = createLibraryView({
    toys: [
      {
        slug: 'milkdrop',
        title: 'MilkDrop Visualizer',
        description: 'Canonical launch route.',
        module: 'assets/js/toys/milkdrop-toy.ts',
        type: 'module',
        requiresWebGPU: true,
        capabilities: {
          demoAudio: true,
          microphone: true,
          motion: false,
        },
      },
    ],
  });

  await view.init();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const listMarkup = document.getElementById('toy-list')?.innerHTML ?? '';
  expect(listMarkup).toContain('/milkdrop/');
  expect(listMarkup).not.toContain('toy.html?toy=milkdrop');
});

test('reset view clears active search, filters, and sort chips from the sticky rail', async () => {
  document.body.innerHTML = `
    <p data-search-results></p>
    <div data-active-filters>
      <span data-active-filters-status></span>
      <div data-active-filters-chips></div>
      <button data-active-filters-clear data-filter-reset type="button">Reset view</button>
    </div>
    <form data-search-form>
      <input id="toy-search" type="search" />
      <button data-search-clear type="button">Clear</button>
      <datalist id="toy-search-suggestions"></datalist>
    </form>
    <details data-library-refine>
      <summary>More filters</summary>
      <button data-filter-chip data-filter-type="tag" data-filter-value="mobile" type="button">Mobile</button>
    </details>
    <select data-sort-control>
      <option value="featured">Featured</option>
      <option value="az">A → Z</option>
    </select>
    <div id="toy-list"></div>
  `;

  const view = createLibraryView({
    toys,
    searchInputId: 'toy-search',
  });

  await view.init();

  const search = document.getElementById('toy-search') as HTMLInputElement;
  const chip = document.querySelector(
    '[data-filter-chip]',
  ) as HTMLButtonElement;
  const sort = document.querySelector(
    '[data-sort-control]',
  ) as HTMLSelectElement;

  search.value = 'mobile';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  chip.click();
  sort.value = 'az';
  sort.dispatchEvent(new Event('change', { bubbles: true }));

  const activeChips = Array.from(
    document.querySelectorAll('.active-filter-chip'),
  ).map((node) => node.textContent?.trim());
  expect(activeChips).toEqual(['Search: mobile', 'Mobile', 'Sort: A → Z']);

  const reset = document.querySelector(
    '[data-filter-reset]',
  ) as HTMLButtonElement;
  reset.click();

  expect(search.value).toBe('');
  expect(sort.value).toBe('featured');
  expect(document.querySelectorAll('.active-filter-chip')).toHaveLength(0);
  expect(document.querySelectorAll('.webtoy-card')).toHaveLength(2);
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

test('renders guidance and feel signals instead of setup-heavy badges', async () => {
  window.location.href = 'https://example.com/';
  window.sessionStorage.clear();
  window.localStorage.clear();

  document.body.innerHTML = `
    <p data-search-results></p>
    <div data-active-filters>
      <span data-active-filters-status></span>
      <button data-active-filters-clear type="button">Reset view</button>
    </div>
    <form data-search-form>
      <input id="toy-search" type="search" />
      <button data-search-clear type="button">Clear</button>
      <datalist id="toy-search-suggestions"></datalist>
    </form>
    <button data-filter-reset type="button">Reset view</button>
    <select data-sort-control>
      <option value="featured">Featured</option>
    </select>
    <div id="toy-list"></div>
  `;

  const view = createLibraryView({
    toys: [
      {
        slug: 'halo-flow',
        title: 'Halo Flow',
        description: 'Layered halos and particles for ambient sessions.',
        module: 'assets/js/toys/halo-flow.ts',
        type: 'module',
        moods: ['serene', 'ethereal'],
        wowControl: 'Halo intensity',
        starterPreset: {
          id: 'halo-glow',
          label: 'halo glow starter',
        },
        recommendedCapability: 'demoAudio',
        capabilities: {
          demoAudio: true,
          microphone: true,
          motion: false,
        },
      },
    ],
    enableCapabilityBadges: true,
  });

  await view.init();

  const card = document.querySelector('.webtoy-card');
  const cardText = card?.textContent ?? '';

  expect(cardText).toContain('Start with: Halo glow starter • Halo intensity');
  expect(cardText).toContain('Serene');
  expect(cardText).toContain('Ethereal');
  expect(cardText).toContain('Open controls');
  expect(cardText).toContain('Start demo');
  expect(card?.querySelector('.webtoy-card-signals')).not.toBeNull();
  expect(card?.querySelector('.capability-badge')).toBeNull();
});

test('falls back to interaction guidance for motion-led toys', async () => {
  window.location.href = 'https://example.com/';
  window.sessionStorage.clear();
  window.localStorage.clear();

  document.body.innerHTML = `
    <p data-search-results></p>
    <div data-active-filters>
      <span data-active-filters-status></span>
      <button data-active-filters-clear type="button">Reset view</button>
    </div>
    <form data-search-form>
      <input id="toy-search" type="search" />
      <button data-search-clear type="button">Clear</button>
      <datalist id="toy-search-suggestions"></datalist>
    </form>
    <button data-filter-reset type="button">Reset view</button>
    <select data-sort-control>
      <option value="featured">Featured</option>
    </select>
    <div id="toy-list"></div>
  `;

  const view = createLibraryView({
    toys,
    enableCapabilityBadges: true,
  });

  await view.init();

  const motionCard = Array.from(document.querySelectorAll('.webtoy-card')).find(
    (card) => card.textContent?.includes('Tilt Wave'),
  );

  expect(motionCard?.textContent).toContain('Start with: Tilt your device');
  expect(motionCard?.textContent).toContain('Tilt');
  expect(motionCard?.textContent).toContain('Energetic');
});
