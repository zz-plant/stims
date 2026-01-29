import { DATA_SELECTORS } from './data-attributes.ts';

export const initNavScrollEffects = () => {
  const nav = document.querySelector(DATA_SELECTORS.topNav);
  if (!nav) return;
  const sectionLinks = Array.from(
    nav.querySelectorAll<HTMLAnchorElement>('[data-section-link]'),
  )
    .map((link) => {
      const href = link.getAttribute('href') ?? '';
      const targetId = href.startsWith('#') ? href.slice(1) : '';
      if (!targetId) return null;
      const section = document.getElementById(targetId);
      if (!section) return null;
      return { link, section, id: targetId };
    })
    .filter(
      (
        entry,
      ): entry is {
        link: HTMLAnchorElement;
        section: HTMLElement;
        id: string;
      } => Boolean(entry),
    );

  let ticking = false;
  const updateActiveSection = () => {
    if (sectionLinks.length === 0) return;
    const offset =
      nav.getBoundingClientRect().height + (window.innerWidth <= 768 ? 40 : 56);
    const scrollPosition = window.scrollY + offset;
    let activeId = sectionLinks[0].id;
    sectionLinks.forEach(({ section, id }) => {
      if (section.offsetTop <= scrollPosition) {
        activeId = id;
      }
    });
    sectionLinks.forEach(({ link, id }) => {
      const isActive = id === activeId;
      link.classList.toggle('is-active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };

  const applyNavState = () => {
    ticking = false;
    const isScrolled = window.scrollY > 24;
    nav.classList.toggle('top-nav--scrolled', isScrolled);
    updateActiveSection();
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
    { passive: true },
  );

  window.addEventListener('resize', applyNavState);
};
