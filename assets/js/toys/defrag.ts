import { startPageToy } from './page-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startPageToy({
    container,
    path: './toys/defrag.html',
    title: 'Defrag Visualizer',
    description: 'Control resolution for the retro spectrum grid.',
  });
}
