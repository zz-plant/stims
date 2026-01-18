import { startPageToy } from './page-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startPageToy({
    container,
    path: './toys/holy.html',
    title: 'Ultimate Satisfying Visualizer',
    description: 'Adjust render scale for halo layers and particle bursts.',
  });
}
