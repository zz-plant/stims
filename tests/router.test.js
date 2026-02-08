import { describe, expect, test } from 'bun:test';
import { createRouter } from '../assets/js/router.ts';

function createWindowStub(href = 'http://example.com/library') {
  const location = new URL(href);
  const listeners = new Map();

  const windowStub = {
    location,
    history: {
      pushState: (_state, _title, nextUrl) => {
        const targetUrl =
          typeof nextUrl === 'string'
            ? new URL(nextUrl, location.href)
            : nextUrl;
        location.href = targetUrl.href;
      },
    },
    addEventListener: (event, handler) => listeners.set(event, handler),
    removeEventListener: (event) => listeners.delete(event),
  };

  return { windowStub, listeners, location };
}

describe('router utilities', () => {
  test('pushes toy state and resets to library', () => {
    const { windowStub, location } = createWindowStub(
      'http://example.com/library',
    );
    const router = createRouter({
      windowRef: () => windowStub,
      queryParam: 'toy',
    });

    router.pushToyState('aurora-painter');
    expect(location.search).toBe('?toy=aurora-painter');

    router.goToLibrary();
    expect(location.search).toBe('');
  });

  test('notifies listeners on popstate', () => {
    const { windowStub, listeners, location } = createWindowStub(
      'http://example.com/library?toy=aurora-painter',
    );
    const originalHref = location.href;
    const router = createRouter({
      windowRef: () => windowStub,
      queryParam: 'toy',
    });

    let observedRoute = null;
    router.listen((route) => {
      observedRoute = route;
    });

    windowStub.history.pushState(
      {},
      '',
      'http://example.com/library?toy=aurora',
    );
    listeners.get('popstate')?.();

    expect(observedRoute).toEqual({ view: 'toy', slug: 'aurora' });
    expect(router.getCurrentSlug()).toBe('aurora');

    windowStub.history.pushState({}, '', originalHref);
    listeners.get('popstate')?.();

    expect(router.getCurrentSlug()).toBe('aurora-painter');
  });
});
