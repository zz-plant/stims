import { startPageToy } from './page-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startPageToy({
    container,
    path: './toys/multi.html',
    title: 'Multi-Capability Visualizer',
    description:
      'Balance performance with render scale before joining the multi-mode scene.',
  });
}
