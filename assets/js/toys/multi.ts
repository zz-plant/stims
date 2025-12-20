import { startIframeToy } from './iframe-toy';
import type { ToyStartOptions } from '../toy-runtime.ts';

export function start({ container }: ToyStartOptions) {
  return startIframeToy({
    container,
    path: './multi.html',
    title: 'Multi-Capability Visualizer',
    description: 'Balance performance with render scale before joining the multi-mode scene.',
  });
}
