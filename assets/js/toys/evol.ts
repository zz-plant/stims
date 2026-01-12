import { startPageToy } from './page-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startPageToy({
    container,
    path: './toys/evol.html',
    title: 'Evolutionary Weirdcore',
  });
}
