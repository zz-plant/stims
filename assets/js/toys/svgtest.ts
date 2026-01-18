import { startPageToy } from './page-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startPageToy({
    container,
    path: './toys/svgtest.html',
    title: 'SVG + Three.js Visualizer',
  });
}
