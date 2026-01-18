import { startPageToy } from './page-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startPageToy({
    container,
    path: './toys/symph.html',
    title: 'Dreamy Spectrograph',
    description:
      'Adjust render quality for the flowing spectrograph and sparkles.',
  });
}
