import toyManifest from '../data/toy-manifest.ts';
import type { ToyManifest } from '../data/toy-schema.ts';
import { createLibraryView } from '../library-view.js';
import { parseToyManifest } from './manifest-client.ts';

const resolveToys = async () => {
  try {
    const response = await fetch('./toys.json', { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      const parsed = parseToyManifest(data, { source: 'toys.json' });
      if (parsed.ok) return parsed.data;
      console.warn(parsed.error.message);
    }
  } catch (error) {
    console.warn('Falling back to bundled toy data', error);
  }
  return toyManifest as ToyManifest;
};

type InitLibraryViewOptions = {
  loadToy: typeof import('../loader.ts').loadToy;
  initNavigation: typeof import('../loader.ts').initNavigation;
  loadFromQuery: typeof import('../loader.ts').loadFromQuery;
};

const ADVANCED_FILTER_KEYS = [
  'capability:motion',
  'capability:demoaudio',
  'feature:webgpu',
] as const;

const hasAdvancedFiltersInUrl = () => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const filters = (params.get('filters') ?? '').toLowerCase();
  return ADVANCED_FILTER_KEYS.some((key) => filters.includes(key));
};

const readExpanded = (element: HTMLElement) =>
  element.getAttribute('aria-expanded') === 'true';

const writeExpanded = (element: HTMLElement, expanded: boolean) => {
  element.setAttribute('aria-expanded', expanded ? 'true' : 'false');
};

const bindAdvancedFiltersToggle = () => {
  if (typeof document === 'undefined') return;
  const toggle = document.querySelector<HTMLElement>(
    '[data-advanced-filters-toggle]',
  );
  const advancedFilters = document.querySelector<HTMLElement>(
    '[data-advanced-filters]',
  );

  if (!toggle || !advancedFilters) return;

  const advancedChips = Array.from(
    document.querySelectorAll<HTMLElement>('[data-filter-advanced]'),
  );

  const syncChipVisibility = (expanded: boolean) => {
    for (const chip of advancedChips) {
      const isActive = chip.classList.contains('is-active');
      chip.hidden = !(expanded || isActive);
    }
  };

  const setExpandedState = (expanded: boolean) => {
    writeExpanded(toggle, expanded);
    toggle.textContent = expanded ? 'Hide filters' : 'More filters';
    advancedFilters.hidden = !expanded;
    syncChipVisibility(expanded);
  };

  setExpandedState(hasAdvancedFiltersInUrl());

  const refreshVisibility = () => {
    syncChipVisibility(readExpanded(toggle));
  };

  const scheduleRefresh = () => {
    window.requestAnimationFrame(refreshVisibility);
  };

  for (const chip of advancedChips) {
    chip.addEventListener('click', scheduleRefresh);
  }

  window.addEventListener('popstate', scheduleRefresh);
  document.addEventListener('library:filters-changed', scheduleRefresh);

  document
    .querySelector('[data-active-filters-clear]')
    ?.addEventListener('click', scheduleRefresh);

  toggle.addEventListener('click', () => {
    setExpandedState(!readExpanded(toggle));
  });
};

export const initLibraryView = async ({
  loadToy,
  initNavigation,
  loadFromQuery,
}: InitLibraryViewOptions) => {
  const libraryView = createLibraryView({
    toys: [],
    loadToy,
    initNavigation,
    loadFromQuery,
    targetId: 'toy-list',
    cardElement: 'a',
    enableIcons: true,
    enableCapabilityBadges: true,
    enableKeyboardHandlers: true,
    enableDarkModeToggle: true,
    themeToggleId: 'theme-toggle',
  });

  const resolvedToys = await resolveToys();
  libraryView.setToys(resolvedToys);
  libraryView.init();
  bindAdvancedFiltersToggle();
  document.body.dataset.libraryEnhanced = 'true';

  return libraryView;
};
