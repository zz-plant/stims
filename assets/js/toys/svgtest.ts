import { startIframeToy } from './iframe-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startIframeToy({
    container,
    path: './svgtest.html',
    title: 'SVG + Three.js Visualizer',
  });
}
