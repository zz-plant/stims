import { startPageToy } from './page-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startPageToy({
    container,
    path: './toys/clay.html',
    title: 'Pottery Wheel Sculptor',
    description:
      'Spin and shape a 3D clay vessel with smoothing, carving, and pinching tools.',
  });
}
