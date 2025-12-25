import { defaultToyLifecycle } from '../core/toy-lifecycle.ts';

export default function noop() {}

export function start({ container } = {}) {
  const placeholder = document.createElement('div');
  placeholder.setAttribute('data-fake-toy', 'true');
  container?.appendChild(placeholder);

  const active = { dispose: () => placeholder.remove() };
  defaultToyLifecycle.adoptActiveToy(active);
  return active;
}
