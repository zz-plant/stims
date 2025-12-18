import { jest } from '@jest/globals';

export default function noop() {}

export function start({ container } = {}) {
  const placeholder = document.createElement('div');
  placeholder.setAttribute('data-fake-toy', 'true');
  container?.appendChild(placeholder);

  const active = { dispose: jest.fn(() => placeholder.remove()) };
  globalThis.__activeWebToy = active;
  return active;
}
