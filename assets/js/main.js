import { initNavigation, loadFromQuery, loadToy } from './loader.ts';
import { initGamepadNavigation } from './utils/gamepad-navigation.ts';
import { initLibraryView } from './utils/init-library.ts';
import { initNavScrollEffects } from './utils/init-nav-scroll.ts';
import { initQuickstartCta } from './utils/init-quickstart.ts';
import { initSystemCheck } from './utils/init-system-check.ts';

const runInit = (label, init) => {
  Promise.resolve()
    .then(() => init())
    .catch((error) => {
      console.error(`Failed to initialize ${label}`, error);
    });
};

const startApp = async () => {
  await initLibraryView({ loadToy, initNavigation, loadFromQuery }).catch(
    (error) => {
      console.error('Failed to initialize library view', error);
    },
  );
  runInit('quickstart CTA', () => initQuickstartCta({ loadToy }));
  runInit('nav scroll effects', initNavScrollEffects);
  runInit('system check', initSystemCheck);
  runInit('gamepad navigation', initGamepadNavigation);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
