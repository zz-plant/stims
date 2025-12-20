import { startIframeToy } from './iframe-toy';
import type { ToyStartOptions } from '../toy-runtime.ts';

export function start({ container }: ToyStartOptions) {
  return startIframeToy({
    container,
    path: './toy.html?toy=evol',
    title: 'Evolutionary Weirdcore',
  });
}
