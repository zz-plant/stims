import { initNavigation, loadToy, loadFromQuery } from './loader.ts';
import { createLibraryView } from './library-view.js';
import { initRepoStatusWidget } from './repo-status.js';
import toysData from './toys-data.js';

const libraryView = createLibraryView({
  toys: [],
  loadToy,
  initNavigation,
  loadFromQuery,
  targetId: 'toy-list',
  searchInputId: 'toy-search',
  cardElement: 'a',
  enableIcons: true,
  enableCapabilityBadges: true,
  enableKeyboardHandlers: true,
  enableDarkModeToggle: true,
  themeToggleId: 'theme-toggle',
});

const resolveToys = async () => {
  try {
    const response = await fetch('./toys.json', { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) return data;
    }
  } catch (error) {
    console.warn('Falling back to bundled toy data', error);
  }
  return toysData;
};

const bindQuickstartCta = () => {
  const quickstart = document.querySelector('[data-quickstart-slug]');
  if (!quickstart || !('dataset' in quickstart)) return;

  const { quickstartSlug } = quickstart.dataset;
  if (!quickstartSlug) return;

  quickstart.addEventListener('click', (event) => {
    const isModifiedClick =
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button === 1;
    if (isModifiedClick) return;

    event.preventDefault();
    loadToy(quickstartSlug, { pushState: true });
  });
};

const initNavScrollEffects = () => {
  const nav = document.querySelector('[data-top-nav]');
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

const initPreviewReels = () => {
  const reels = document.querySelectorAll('[data-preview-reel]');
  const Observer = globalThis.IntersectionObserver;
  if (reels.length === 0 || typeof Observer === 'undefined') return;

  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  );

  reels.forEach((reel) => {
    const cards = Array.from(reel.querySelectorAll('[data-preview-card]'));
    const dots = Array.from(reel.querySelectorAll('[data-preview-dot]'));
    if (cards.length === 0) return;

    let timerId;
    let activeIndex = Math.max(
      0,
      cards.findIndex((card) => card.classList.contains('is-active'))
    );

    const lazyLoadMedia = (card) => {
      if (!card || card.dataset.loaded === 'true') return;
      const media = card.querySelector('.preview-media');
      const src = card.getAttribute('data-preview-src');
      if (media && src) {
        media.style.setProperty('--preview-image', `url(${src})`);
      }
      card.dataset.loaded = 'true';
    };

    const setActive = (index) => {
      activeIndex = index;
      cards.forEach((card, idx) => {
        const isActive = idx === index;
        card.classList.toggle('is-active', isActive);
        if (dots[idx]) {
          dots[idx].classList.toggle('is-active', isActive);
        }
        if (isActive) lazyLoadMedia(card);
      });
    };

    const tick = () => {
      const nextIndex = (activeIndex + 1) % cards.length;
      setActive(nextIndex);
    };

    const startTimer = () => {
      if (prefersReducedMotion.matches || cards.length < 2) return;
      timerId = window.setInterval(tick, 5200);
    };

    const stopTimer = () => {
      if (timerId) {
        window.clearInterval(timerId);
        timerId = undefined;
      }
    };

    const observer = new Observer(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            lazyLoadMedia(cards[activeIndex]);
            startTimer();
          } else {
            stopTimer();
          }
        });
      },
      { threshold: 0.4 }
    );

    observer.observe(reel);
    setActive(activeIndex);

    prefersReducedMotion.addEventListener('change', () => {
      stopTimer();
      if (!prefersReducedMotion.matches) {
        startTimer();
      }
    });
  });
};

const startApp = async () => {
  const resolvedToys = await resolveToys();
  libraryView.setToys(resolvedToys);
  libraryView.init();
  bindQuickstartCta();
  initNavScrollEffects();
  initPreviewReels();
  document.body.dataset.libraryEnhanced = 'true';
  void initRepoStatusWidget();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
