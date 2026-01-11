import { startIframeToy } from './iframe-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startIframeToy({
    container,
    path: './toys/words.html',
    title: 'Interactive Word Cloud',
    description:
      'Cap DPI or boost density for the microphone-driven word cloud.',
  });
}
