import { startIframeToy } from './iframe-toy';
import type { ToyStartOptions } from '../toy-runtime.ts';

export function start({ container }: ToyStartOptions) {
  return startIframeToy({
    container,
    path: './clay.html',
    title: 'Pottery Wheel Sculptor',
    description: 'Adjust render quality while you spin, smooth, and carve the clay.',
  });
}
