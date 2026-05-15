import type { ToyEntry } from '../data/toy-schema.ts';
import { createLibraryView } from '../library-view.js';
import type { createLoader } from '../loader.ts';
import { initNavigation as initTopNav } from '../ui/nav.ts';
import { initNavScrollEffects } from '../ui/nav-scroll-effects.ts';
import { initLibraryView } from './library-page-view.ts';
import { initMilkdropShowcase } from './milkdrop-showcase.ts';
import { initQuickstartCta } from './quickstart-cta.ts';
import { initSystemCheck } from './system-check.ts';

type LoaderApi = ReturnType<typeof createLoader>;
type Toy = Pick<ToyEntry, 'slug' | 'title'>;

const runInit = (label: string, init: () => void | Promise<void>) => {
  try {
    Promise.resolve(init()).catch((error) => {
      console.error(`Failed to initialize ${label}`, error);
    });
  } catch (error) {
    console.error(`Failed to initialize ${label}`, error);
  }
};

export function bootLibraryPage({
  navContainer,
  loadToy,
  initNavigation,
  loadFromQuery,
}: {
  navContainer: HTMLElement | null;
  loadToy: LoaderApi['loadToy'];
  initNavigation: LoaderApi['initNavigation'];
  loadFromQuery: LoaderApi['loadFromQuery'];
}) {
  if (navContainer) {
    initTopNav(navContainer, { mode: 'library' });
  }

  runInit('library view', async () => {
    const overrides = (globalThis as unknown as { __stimsToyLibrary?: Toy[] })
      .__stimsToyLibrary;
    if (overrides) {
      const libraryView = createLibraryView({
        toys: overrides,
        loadToy,
        initNavigation,
        loadFromQuery,
        targetId: 'toy-list',
        searchInputId: 'toy-search',
        cardElement: 'a',
        enableIcons: false,
        enableCapabilityBadges: true,
        enableKeyboardHandlers: true,
        enableDarkModeToggle: true,
        themeToggleId: 'theme-toggle',
      });
      await libraryView.init();
      document.body.dataset.libraryEnhanced = 'true';
      return;
    }

    await initLibraryView({ loadToy, initNavigation, loadFromQuery });
  });

  runInit('quickstart CTA', () => initQuickstartCta({ loadToy }));
  runInit('milkdrop showcase', initMilkdropShowcase);
  runInit('nav scroll effects', initNavScrollEffects);
  runInit('system check', initSystemCheck);
}
