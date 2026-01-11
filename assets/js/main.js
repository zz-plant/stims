import { initNavigation, loadToy, loadFromQuery } from './loader.ts';
import { initRepoStatusWidget } from './repo-status.js';
import { initReadinessProbe } from './readiness-probe.js';
import { initLibraryView } from './utils/init-library.ts';
import { initQuickstartCta } from './utils/init-quickstart.ts';
import { initNavScrollEffects } from './utils/init-nav-scroll.ts';
import { initPreviewReels } from './utils/init-preview-reels.ts';

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
    }
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
