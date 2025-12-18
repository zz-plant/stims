import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './toy.html?toy=words',
    title: 'Interactive Word Cloud',
  });
}
