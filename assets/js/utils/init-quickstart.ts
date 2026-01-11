import { DATA_SELECTORS, DATASET_KEYS } from './data-attributes.ts';

type InitQuickstartOptions = {
  loadToy: typeof import('../loader.ts').loadToy;
};

export const initQuickstartCta = ({ loadToy }: InitQuickstartOptions) => {
  const quickstart = document.querySelector(DATA_SELECTORS.quickstart);
  if (!quickstart || !('dataset' in quickstart)) return;

  const quickstartSlug = quickstart.dataset[DATASET_KEYS.quickstartSlug];
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
