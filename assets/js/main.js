import { initNavigation, loadToy, loadFromQuery } from './loader.ts';
import { initRepoStatusWidget } from './repo-status.js';
import { initReadinessProbe } from './readiness-probe.js';
import { initLibraryView } from './utils/init-library.ts';
import { initQuickstartCta } from './utils/init-quickstart.ts';
import { initNavScrollEffects } from './utils/init-nav-scroll.ts';
import { initPreviewReels } from './utils/init-preview-reels.ts';

const startApp = async () => {
  initReadinessProbe();
  await initLibraryView({ loadToy, initNavigation, loadFromQuery });
  initQuickstartCta({ loadToy });
  initNavScrollEffects();
  initPreviewReels();
  void initRepoStatusWidget();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
