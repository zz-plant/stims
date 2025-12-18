import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './brand.html',
    title: 'Star Guitar Visualizer',
  });
}
