import { initNavigation, loadFromQuery, loadToy } from './loader.ts';
import { initReadinessProbe } from './readiness-probe.js';
import { initRepoStatusWidget } from './repo-status.js';
import { initLibraryView } from './utils/init-library.ts';
import { initNavScrollEffects } from './utils/init-nav-scroll.ts';
import { initPreviewReels } from './utils/init-preview-reels.ts';
import { initQuickstartCta } from './utils/init-quickstart.ts';

const runInit = (label, init) => {
  Promise.resolve()
    .then(() => init())
    .catch((error) => {
      console.error(`Failed to initialize ${label}`, error);
    });
};

const startApp = async () => {
  initReadinessProbe();
  await initLibraryView({ loadToy, initNavigation, loadFromQuery }).catch(
    (error) => {
      console.error('Failed to initialize library view', error);
    },
  );
  runInit('quickstart CTA', () => initQuickstartCta({ loadToy }));
  runInit('nav scroll effects', initNavScrollEffects);
  runInit('preview reels', initPreviewReels);
  runInit('repo status widget', initRepoStatusWidget);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
