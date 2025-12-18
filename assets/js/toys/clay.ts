import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './clay.html',
    title: 'Pottery Wheel Sculptor',
  });
}
