import { startIframeToy } from './iframe-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startIframeToy({
    container,
    path: 'toys/lights.html',
    title: 'Audio Light Show',
    description: 'Dial quality for the cube lighting playground.',
  });
}
