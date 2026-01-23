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
    path: './toys/multi.html',
    preferDemoAudio,
    title: 'Multi-Capability Visualizer',
    description:
      'Balance performance with render scale before joining the multi-mode scene.',
  });
}
