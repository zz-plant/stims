import { startIframeToy } from './iframe-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startIframeToy({
    container,
    path: './holy.html',
    title: 'Ultimate Satisfying Visualizer',
    description: 'Adjust render scale for halo layers and particle bursts.',
  });
}
