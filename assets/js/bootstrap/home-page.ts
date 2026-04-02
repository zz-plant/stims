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

function initHomeMobileDock() {
  const body = document.body;
  const hero = document.querySelector<HTMLElement>('#overview');
  const dock = document.querySelector<HTMLElement>('.home-mobile-dock');

  if (!hero || !dock) {
    return;
  }

  const mobileQuery = window.matchMedia('(max-width: 767px)');
  let observer: IntersectionObserver | null = null;

  const setDockState = (state: 'hidden' | 'visible') => {
    body.dataset.homeDockState = state;
  };

  const teardownObserver = () => {
    observer?.disconnect();
    observer = null;
  };

  const syncDock = () => {
    if (!mobileQuery.matches) {
      teardownObserver();
      body.removeAttribute('data-home-dock-state');
      return;
    }

    setDockState('hidden');
    if (observer || typeof IntersectionObserver !== 'function') {
      return;
    }

    observer = new IntersectionObserver(
      ([entry]) => {
        const heroStillDominant =
          entry?.isIntersecting === true && entry.intersectionRatio > 0.38;
        setDockState(heroStillDominant ? 'hidden' : 'visible');
      },
      {
        threshold: [0.2, 0.38, 0.55],
        rootMargin: '0px 0px -20% 0px',
      },
    );
    observer.observe(hero);
  };

  syncDock();
  mobileQuery.addEventListener('change', syncDock);
}

export function bootHomePage({
  navContainer,
}: {
  navContainer: HTMLElement | null;
}) {
  if (navContainer) {
    initTopNav(navContainer, {
      mode: 'library',
      sectionLinks: [
        { href: '#overview', label: 'Start' },
        { href: '#presets', label: 'Presets' },
      ],
      utilityLink: {
        href: '/milkdrop/',
        label: 'Open launchpad',
      },
    });
  }

  runInit('milkdrop showcase', initMilkdropShowcase);
  runInit('nav scroll effects', initNavScrollEffects);
  runInit('home mobile dock', initHomeMobileDock);
}
