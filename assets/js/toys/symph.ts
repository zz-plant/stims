import { startIframeToy } from './iframe-toy';
import type { ToyStartOptions } from '../toy-runtime.ts';

export function start({ container }: ToyStartOptions) {
  return startIframeToy({
    container,
    path: './symph.html',
    title: 'Dreamy Spectrograph',
    description: 'Adjust render quality for the flowing spectrograph and sparkles.',
  });
}
