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
    path: './toys/evol.html',
    preferDemoAudio,
    title: 'Evolutionary Weirdcore',
  });
}
