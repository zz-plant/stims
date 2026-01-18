import { startPageToy } from './page-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startPageToy({
    container,
    path: './toys/seary.html',
    title: 'Trippy Synesthetic Visualizer',
    description: 'Tune pixel ratio and density for sparkles and bursts.',
  });
}
