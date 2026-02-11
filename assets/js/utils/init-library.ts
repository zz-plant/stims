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

export const initLibraryView = async ({
  loadToy,
  initNavigation,
  loadFromQuery,
}: InitLibraryViewOptions) => {
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

    const hasAdvancedFiltersInUrl = () => {
      if (typeof window === 'undefined') return false;
      const params = new URLSearchParams(window.location.search);
      const filters = (params.get('filters') ?? '').toLowerCase();
      return (
        filters.includes('capability:motion') ||
        filters.includes('capability:demoaudio') ||
        filters.includes('feature:webgpu')
      );
    };

    const syncChipVisibility = (expanded: boolean) => {
      advancedChips.forEach((chip) => {
        const isActive = chip.classList.contains('is-active');
        chip.hidden = !(expanded || isActive);
      });
    };

    const setExpanded = (expanded: boolean) => {
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggle.textContent = expanded ? 'Hide refinements' : 'Refine results';
      advancedFilters.hidden = !expanded;
      syncChipVisibility(expanded);
    };

    const shouldStartExpanded = hasAdvancedFiltersInUrl();
    setExpanded(shouldStartExpanded);

    const refreshVisibility = () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      syncChipVisibility(expanded);
    };

    advancedChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        window.requestAnimationFrame(refreshVisibility);
      });
    });

    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      setExpanded(!expanded);
    });
  };

  const libraryView = createLibraryView({
    toys: [],
    loadToy,
    initNavigation,
    loadFromQuery,
    targetId: 'toy-list',
    searchInputId: 'toy-search',
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
