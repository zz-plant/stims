import { startIframeToy } from './iframe-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startIframeToy({
    container,
    path: './toy.html?toy=evol',
    title: 'Evolutionary Weirdcore',
  });
}
