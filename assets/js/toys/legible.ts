import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './legible.html',
    title: 'Terminal Word Grid',
  });
}
