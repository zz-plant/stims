import { startIframeToy } from './iframe-toy';
import type { ToyStartOptions } from '../toy-runtime.ts';

export function start({ container }: ToyStartOptions) {
  return startIframeToy({
    container,
    path: './toy.html?toy=words',
    title: 'Interactive Word Cloud',
    description: 'Cap DPI or boost density for the microphone-driven word cloud.',
  });
}
