import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './toy.html?toy=words',
    title: 'Interactive Word Cloud',
    description: 'Cap DPI or boost density for the microphone-driven word cloud.',
  });
}
