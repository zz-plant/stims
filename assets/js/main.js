import { initNavigation, loadToy, loadFromQuery } from './loader.ts';
import { initRepoStatusWidget } from './repo-status.js';
import { initReadinessProbe } from './readiness-probe.js';
import { initLibraryView } from './utils/init-library.ts';
import { initQuickstartCta } from './utils/init-quickstart.ts';
import { initNavScrollEffects } from './utils/init-nav-scroll.ts';
import { initPreviewReels } from './utils/init-preview-reels.ts';

const safeInit = async (label, init) => {
  try {
    await init();
  } catch (error) {
    console.error(`Failed to initialize ${label}`, error);
  }
};

const startApp = async () => {
  initReadinessProbe();
  await safeInit('library view', () =>
    initLibraryView({ loadToy, initNavigation, loadFromQuery })
  );
  await safeInit('quickstart CTA', () => initQuickstartCta({ loadToy }));
  await safeInit('nav scroll effects', initNavScrollEffects);
  await safeInit('preview reels', initPreviewReels);
  await safeInit('repo status widget', initRepoStatusWidget);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
