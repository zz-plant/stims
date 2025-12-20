import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './multi.html',
    title: 'Multi-Capability Visualizer',
    description: 'Balance performance with render scale before joining the multi-mode scene.',
  });
}
