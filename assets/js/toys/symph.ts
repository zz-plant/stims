import { startIframeToy } from './iframe-toy';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startIframeToy({
    container,
    path: './toys/symph.html',
    title: 'Dreamy Spectrograph',
    description:
      'Adjust render quality for the flowing spectrograph and sparkles.',
  });
}
