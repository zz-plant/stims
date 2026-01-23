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
    path: './toys/holy.html',
    preferDemoAudio,
    title: 'Ultimate Satisfying Visualizer',
    description: 'Adjust render scale for halo layers and particle bursts.',
  });
}
