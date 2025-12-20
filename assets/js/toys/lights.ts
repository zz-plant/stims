import { startIframeToy } from './iframe-toy';
import type { ToyStartOptions } from '../toy-runtime.ts';

export function start({ container }: ToyStartOptions) {
  return startIframeToy({
    container,
    path: './lights.html',
    title: 'Audio Light Show',
    description: 'Dial quality for the cube lighting playground.',
  });
}
