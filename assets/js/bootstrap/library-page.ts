import type { ToyEntry } from '../data/toy-schema.ts';
import { createLibraryView } from '../library-view.js';
import type { createLoader } from '../loader.ts';
import { initNavigation as initTopNav } from '../ui/nav.ts';
import { initLibraryView } from '../utils/init-library.ts';
import { initNavScrollEffects } from '../utils/init-nav-scroll.ts';
import { initQuickstartCta } from '../utils/init-quickstart.ts';
import { initSystemCheck } from '../utils/init-system-check.ts';
import { initStimBuilder } from '../utils/stim-builder.ts';

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
  runInit('nav scroll effects', initNavScrollEffects);
  runInit('system check', initSystemCheck);
  runInit('stim builder', initStimBuilder);
}
