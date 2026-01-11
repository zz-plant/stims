import { DATA_SELECTORS } from './data-attributes.ts';

export const initNavScrollEffects = () => {
  const nav = document.querySelector(DATA_SELECTORS.topNav);
  if (!nav) return;

  let ticking = false;
  const applyNavState = () => {
    ticking = false;
    const isScrolled = window.scrollY > 24;
    nav.classList.toggle('top-nav--scrolled', isScrolled);
  };

  applyNavState();
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        window.requestAnimationFrame(applyNavState);
        ticking = true;
      }
    },
    { passive: true }
  );
};
