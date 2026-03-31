import toyManifest from '../data/toy-manifest.ts';
import type { ToyManifest } from '../data/toy-schema.ts';
import { createLibraryView } from '../library-view.js';
import { recordLibraryVisit } from '../utils/growth-metrics.ts';
import { parseToyManifest } from '../utils/manifest-client.ts';

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
  recordLibraryVisit();

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
  document.body.dataset.libraryEnhanced = 'true';

  return libraryView;
};
