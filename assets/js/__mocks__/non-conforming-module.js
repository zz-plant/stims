export function start({ container } = {}) {
  const marker = document.createElement('div');
  marker.setAttribute('data-fake-toy', 'true');
  marker.setAttribute('data-module', 'non-conforming');
  container?.appendChild(marker);

  return 'invalid-start-return';
}
