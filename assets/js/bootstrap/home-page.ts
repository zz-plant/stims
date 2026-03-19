import { initNavigation as initTopNav } from '../ui/nav.ts';
import { initMilkdropShowcase } from '../utils/init-milkdrop-showcase.ts';
import { initNavScrollEffects } from '../utils/init-nav-scroll.ts';
import { initSystemCheck } from '../utils/init-system-check.ts';

const runInit = (label: string, init: () => void | Promise<void>) => {
  try {
    Promise.resolve(init()).catch((error) => {
      console.error(`Failed to initialize ${label}`, error);
    });
  } catch (error) {
    console.error(`Failed to initialize ${label}`, error);
  }
};

export function bootHomePage({
  navContainer,
}: {
  navContainer: HTMLElement | null;
}) {
  if (navContainer) {
    initTopNav(navContainer, { mode: 'library' });
  }

  runInit('milkdrop showcase', initMilkdropShowcase);
  runInit('nav scroll effects', initNavScrollEffects);
  runInit('system check', () =>
    initSystemCheck({ enablePreflightModal: false }),
  );
}
