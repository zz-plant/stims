import { startIframeToy } from './iframe-toy';
import type { ToyStartOptions } from '../toy-runtime.ts';

export function start({ container }: ToyStartOptions) {
  return startIframeToy({
    container,
    path: './geom.html',
    title: 'Microphone Geometry Visualizer',
    description: 'Cap resolution or boost fidelity for the 2D particle grid.',
  });
}
