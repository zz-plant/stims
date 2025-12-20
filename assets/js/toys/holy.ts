import { startIframeToy } from './iframe-toy';
import type { ToyStartOptions } from '../toy-runtime.ts';

export function start({ container }: ToyStartOptions) {
  return startIframeToy({
    container,
    path: './holy.html',
    title: 'Ultimate Satisfying Visualizer',
    description: 'Adjust render scale for halo layers and particle bursts.',
  });
}
