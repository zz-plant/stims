import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './seary.html',
    title: 'Trippy Synesthetic Visualizer',
  });
}
