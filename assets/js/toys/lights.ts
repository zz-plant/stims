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
    path: 'toys/lights.html',
    preferDemoAudio,
    title: 'Audio Light Show',
    description: 'Dial quality for the cube lighting playground.',
  });
}
