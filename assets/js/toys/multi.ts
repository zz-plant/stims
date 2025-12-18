import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './multi.html',
    title: 'Multi-Capability Visualizer',
  });
}
