import { startIframeToy } from './iframe-toy';
import type { ToyStartOptions } from '../toy-runtime.ts';

export function start({ container }: ToyStartOptions) {
  return startIframeToy({
    container,
    path: './brand.html',
    title: 'Star Guitar Visualizer',
    description: 'Tweak quality while soaring through the neon skyline.',
  });
}
