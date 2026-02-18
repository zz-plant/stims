import { initNavigation } from '../ui/nav.ts';

export interface ToyPageShellOptions {
  container?: HTMLElement | null;
  backHref?: string;
  title?: string;
  slug?: string;
  embedded?: boolean;
}

export const initToyPageShell = (
  options: ToyPageShellOptions = {},
): HTMLElement | null => {
  const doc = options.container?.ownerDocument ?? document;
  const win = doc.defaultView ?? window;
  const backHref = options.backHref ?? '../index.html';
  const title = options.title ?? doc.title;
  const embeddedFromQuery = new URL(win.location.href).searchParams.get(
    'embed',
  );
  const isEmbedded =
    options.embedded ?? (embeddedFromQuery === '1' || win.self !== win.top);
  let container =
    options.container ?? doc.querySelector<HTMLElement>('[data-toy-nav]');

  if (!container) {
    container = doc.createElement('div');
    container.dataset.toyNav = 'true';
    doc.body.insertAdjacentElement('afterbegin', container);
  }

  if (isEmbedded) {
    container.remove();
    return null;
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
