import { startPageToy } from './page-toy';

export function start({
  container,
  preferDemoAudio,
}: {
  container?: HTMLElement | null;
  preferDemoAudio?: boolean;
} = {}) {
  return startPageToy({
    container,
    path: './toys/clay.html',
    preferDemoAudio,
    title: 'Pottery Wheel Sculptor',
    description:
      'Spin and shape a 3D clay vessel with smoothing, carving, and pinching tools.',
  });
}
