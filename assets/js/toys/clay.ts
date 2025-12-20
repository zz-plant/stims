import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './clay.html',
    title: 'Pottery Wheel Sculptor',
    description: 'Adjust render quality while you spin, smooth, and carve the clay.',
  });
}
