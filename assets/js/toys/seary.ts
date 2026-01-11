import { startIframeToy } from './iframe-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startIframeToy({
    container,
    path: './seary.html',
    title: 'Trippy Synesthetic Visualizer',
    description: 'Tune pixel ratio and density for sparkles and bursts.',
  });
}
