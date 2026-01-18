import { startPageToy } from './page-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startPageToy({
    container,
    path: 'toys/lights.html',
    title: 'Audio Light Show',
    description: 'Dial quality for the cube lighting playground.',
  });
}
