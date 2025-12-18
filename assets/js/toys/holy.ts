import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './holy.html',
    title: 'Ultimate Satisfying Visualizer',
  });
}
