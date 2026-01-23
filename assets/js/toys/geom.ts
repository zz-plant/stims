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
    path: './toys/geom.html',
    preferDemoAudio,
    title: 'Microphone Geometry Visualizer',
    description: 'Cap resolution or boost fidelity for the 2D particle grid.',
  });
}
