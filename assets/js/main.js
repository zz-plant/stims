import { initNavigation, loadToy, loadFromQuery } from './loader.ts';
import { initRepoStatusWidget } from './repo-status.js';
import { initReadinessProbe } from './readiness-probe.js';
import { initLibraryView } from './utils/init-library.ts';
import { initQuickstartCta } from './utils/init-quickstart.ts';
import { initNavScrollEffects } from './utils/init-nav-scroll.ts';
import { initPreviewReels } from './utils/init-preview-reels.ts';

const startApp = async () => {
  const safeInit = async (name, fn) => {
    try {
      await fn();
    } catch (error) {
      console.error(`[main] ${name} failed`, error);
    }
  };

  await safeInit('initReadinessProbe', () => initReadinessProbe());
  await safeInit('initLibraryView', () =>
    initLibraryView({ loadToy, initNavigation, loadFromQuery })
  );
  await safeInit('initQuickstartCta', () => initQuickstartCta({ loadToy }));
  await safeInit('initNavScrollEffects', () => initNavScrollEffects());
  await safeInit('initPreviewReels', () => initPreviewReels());
  void safeInit('initRepoStatusWidget', () => initRepoStatusWidget());
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
