import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './svgtest.html',
    title: 'SVG + Three.js Visualizer',
  });
}
