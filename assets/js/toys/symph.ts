import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './symph.html',
    title: 'Dreamy Spectrograph',
    description:
      'Adjust render quality for the flowing spectrograph and sparkles.',
  });
}
