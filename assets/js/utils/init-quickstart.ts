import { DATA_SELECTORS, DATASET_KEYS } from './data-attributes.ts';

type InitQuickstartOptions = {
  loadToy: typeof import('../loader.ts').loadToy;
};

export const initQuickstartCta = ({ loadToy }: InitQuickstartOptions) => {
  const quickstarts = document.querySelectorAll(DATA_SELECTORS.quickstart);
  if (!quickstarts.length) return;

  quickstarts.forEach((quickstart) => {
    if (!(quickstart instanceof HTMLElement)) return;

    const quickstartSlug = quickstart.dataset[DATASET_KEYS.quickstartSlug];
    if (!quickstartSlug) return;

    const quickstartMode = quickstart.dataset[DATASET_KEYS.quickstartMode];

    quickstart.addEventListener('click', (event) => {
      const isModifiedClick =
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button === 1;
      if (isModifiedClick) return;

      event.preventDefault();
      loadToy(quickstartSlug, {
        pushState: true,
        preferDemoAudio: quickstartMode === 'demo',
      });
    });
  });
};
