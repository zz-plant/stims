import { startIframeToy } from './iframe-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startIframeToy({
    container,
    path: './toys/defrag.html',
    title: 'Defrag Visualizer',
    description: 'Control resolution for the retro spectrum grid.',
  });
}
