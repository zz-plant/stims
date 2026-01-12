import { startPageToy } from './page-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startPageToy({
    container,
    path: './toys/geom.html',
    title: 'Microphone Geometry Visualizer',
    description: 'Cap resolution or boost fidelity for the 2D particle grid.',
  });
}
