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
    path: './toys/seary.html',
    preferDemoAudio,
    title: 'Trippy Synesthetic Visualizer',
    description: 'Tune pixel ratio and density for sparkles and bursts.',
  });
}
