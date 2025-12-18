import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './geom.html',
    title: 'Microphone Geometry Visualizer',
  });
}
