import { initNavigation } from '../ui/nav.ts';

export interface ToyPageShellOptions {
  container?: HTMLElement | null;
  backHref?: string;
  title?: string;
  slug?: string;
}

export const initToyPageShell = (options: ToyPageShellOptions = {}) => {
  const doc = options.container?.ownerDocument ?? document;
  const win = doc.defaultView ?? window;
  const backHref = options.backHref ?? '../index.html';
  const title = options.title ?? doc.title;
  let container =
    options.container ?? doc.querySelector<HTMLElement>('[data-toy-nav]');

  if (!container) {
    container = doc.createElement('div');
    container.dataset.toyNav = 'true';
    doc.body.insertAdjacentElement('afterbegin', container);
  }

  initNavigation(container, {
    mode: 'toy',
    title,
    slug: options.slug,
    onBack: () => {
      win.location.href = backHref;
    },
  });

  return container;
};
