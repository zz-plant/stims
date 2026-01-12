import { startPageToy } from './page-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startPageToy({
    container,
    path: './toys/words.html',
    title: 'Interactive Word Cloud',
    description:
      'Cap DPI or boost density for the microphone-driven word cloud.',
  });
}
