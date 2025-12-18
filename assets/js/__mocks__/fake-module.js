export default function noop() {}

export function start({ container } = {}) {
  const placeholder = document.createElement('div');
  placeholder.setAttribute('data-fake-toy', 'true');
  container?.appendChild(placeholder);

  return { dispose: () => placeholder.remove() };
}
