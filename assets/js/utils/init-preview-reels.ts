import { DATA_SELECTORS } from './data-attributes.ts';

export const initPreviewReels = () => {
  const reels = document.querySelectorAll(DATA_SELECTORS.previewReel);
  const Observer = globalThis.IntersectionObserver;
  if (reels.length === 0 || typeof Observer === 'undefined') return;

  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  );

  reels.forEach((reel) => {
    const cards = Array.from(reel.querySelectorAll(DATA_SELECTORS.previewCard));
    const dots = Array.from(reel.querySelectorAll(DATA_SELECTORS.previewDot));
    const status = reel.querySelector(DATA_SELECTORS.previewStatus);
    const prevButton = reel.querySelector(DATA_SELECTORS.previewPrev);
    const nextButton = reel.querySelector(DATA_SELECTORS.previewNext);
    const toggleButton = reel.querySelector(DATA_SELECTORS.previewToggle);
    if (cards.length === 0) return;

    let timerId: number | undefined;
    let isIntersecting = false;
    let isFocused = false;
    let isAutoPlay = !prefersReducedMotion.matches;
    let activeIndex = Math.max(
      0,
      cards.findIndex((card) => card.classList.contains('is-active')),
    );

    const lazyLoadMedia = (card: Element) => {
      if (!(card instanceof HTMLElement) || card.dataset.loaded === 'true')
        return;
      const media = card.querySelector('.preview-media') as HTMLElement | null;
      const src = card.getAttribute('data-preview-src');
      if (media && src) {
        media.style.setProperty('--preview-image', `url(${src})`);
      }
      card.dataset.loaded = 'true';
    };

    const updateToggleState = () => {
      if (!toggleButton) return;
      toggleButton.textContent = isAutoPlay ? 'Pause' : 'Play';
      toggleButton.setAttribute(
        'aria-label',
        isAutoPlay ? 'Pause auto-advance' : 'Play auto-advance',
      );
      toggleButton.setAttribute('aria-pressed', String(isAutoPlay));
    };

    const announceStatus = (index: number) => {
      if (!status) return;
      status.textContent = `Preview ${index + 1} of ${cards.length}`;
    };

    const setActive = (index: number) => {
      activeIndex = index;
      cards.forEach((card, idx) => {
        const isActive = idx === index;
        card.classList.toggle('is-active', isActive);
        card.setAttribute('aria-hidden', String(!isActive));
        if (dots[idx]) {
          dots[idx].classList.toggle('is-active', isActive);
          dots[idx].setAttribute('aria-selected', String(isActive));
        }
        if (isActive) lazyLoadMedia(card);
      });
      announceStatus(index);
    };

    const tick = () => {
      const nextIndex = (activeIndex + 1) % cards.length;
      setActive(nextIndex);
    };

    const startTimer = () => {
      if (
        prefersReducedMotion.matches ||
        cards.length < 2 ||
        timerId ||
        !isAutoPlay ||
        !isIntersecting ||
        isFocused
      )
        return;
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
          isIntersecting = entry.isIntersecting;
          if (entry.isIntersecting) {
            lazyLoadMedia(cards[activeIndex]);
            startTimer();
          } else {
            stopTimer();
          }
        });
      },
      { threshold: 0.4 },
    );

    observer.observe(reel);
    setActive(activeIndex);
    updateToggleState();

    prefersReducedMotion.addEventListener('change', () => {
      stopTimer();
      if (prefersReducedMotion.matches) {
        isAutoPlay = false;
        updateToggleState();
        return;
      }
      if (isAutoPlay) startTimer();
    });

    if (prevButton) {
      prevButton.addEventListener('click', () => {
        stopTimer();
        isAutoPlay = false;
        updateToggleState();
        const nextIndex = (activeIndex - 1 + cards.length) % cards.length;
        setActive(nextIndex);
      });
    }

    if (nextButton) {
      nextButton.addEventListener('click', () => {
        stopTimer();
        isAutoPlay = false;
        updateToggleState();
        tick();
      });
    }

    if (toggleButton) {
      toggleButton.addEventListener('click', () => {
        if (isAutoPlay) {
          isAutoPlay = false;
          stopTimer();
        } else {
          isAutoPlay = true;
        }
        updateToggleState();
        startTimer();
      });
    }

    dots.forEach((dot, index) => {
      dot.addEventListener('click', () => {
        stopTimer();
        isAutoPlay = false;
        updateToggleState();
        setActive(index);
      });
    });

    reel.addEventListener('focusin', () => {
      isFocused = true;
      stopTimer();
    });

    reel.addEventListener('focusout', (event) => {
      const focusEvent = event as FocusEvent;
      if (
        focusEvent.relatedTarget instanceof Node &&
        reel.contains(focusEvent.relatedTarget)
      )
        return;
      isFocused = false;
      if (isAutoPlay) startTimer();
    });
  });
};
