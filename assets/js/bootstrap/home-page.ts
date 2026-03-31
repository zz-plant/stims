import { initNavigation as initTopNav } from '../ui/nav.ts';
import { initNavScrollEffects } from '../ui/nav-scroll-effects.ts';
import { initMilkdropShowcase } from './milkdrop-showcase.ts';

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
    initTopNav(navContainer, {
      mode: 'library',
      sectionLinks: [
        { href: '#launches', label: 'Start' },
        { href: '#presets', label: 'Presets' },
        { href: '#why-stims', label: 'Workflow' },
      ],
      utilityLink: {
        href: '/milkdrop/',
        label: 'Open launchpad',
      },
    });
  }

  runInit('milkdrop showcase', initMilkdropShowcase);
  runInit('nav scroll effects', initNavScrollEffects);
}
