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
    path: './toys/symph.html',
    preferDemoAudio,
    title: 'Dreamy Spectrograph',
    description:
      'Adjust render quality for the flowing spectrograph and sparkles.',
  });
}
