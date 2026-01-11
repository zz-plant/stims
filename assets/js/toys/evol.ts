import { startIframeToy } from './iframe-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startIframeToy({
    container,
    path: './toys/evol.html',
    title: 'Evolutionary Weirdcore',
  });
}
