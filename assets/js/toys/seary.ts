import { startIframeToy } from './iframe-toy';
import type { ToyStartOptions } from '../toy-runtime.ts';

export function start({ container }: ToyStartOptions) {
  return startIframeToy({
    container,
    path: './seary.html',
    title: 'Trippy Synesthetic Visualizer',
    description: 'Tune pixel ratio and density for sparkles and bursts.',
  });
}
