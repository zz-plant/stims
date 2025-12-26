import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './toy.html?toy=defrag',
    title: 'Defrag Visualizer',
    description: 'Control resolution for the retro spectrum grid.',
  });
}
