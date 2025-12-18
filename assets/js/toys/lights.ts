import { startIframeToy } from './iframe-toy';

export function start({ container } = {}) {
  return startIframeToy({
    container,
    path: './lights.html',
    title: 'Audio Light Show',
  });
}
