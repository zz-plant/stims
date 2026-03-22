import { describe, expect, test } from 'bun:test';
import { createRouter, getToyRouteHref } from '../assets/js/router.ts';

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
  test('returns canonical hrefs for mapped toy routes', () => {
    expect(getToyRouteHref('milkdrop')).toBe('/milkdrop/');
    expect(getToyRouteHref('custom-slug')).toBe(
      '/milkdrop/?experience=custom-slug',
    );
  });

  test('pushes toy state and resets to library', () => {
    const { windowStub, location } = createWindowStub(
      'http://example.com/library',
    );
    const router = createRouter({
      windowRef: () => windowStub,
      queryParam: 'experience',
    });

    router.pushToyState('milkdrop');
    expect(location.pathname).toBe('/milkdrop/');
    expect(location.search).toBe('');

    router.goToLibrary();
    expect(location.pathname).toBe('/');
    expect(location.search).toBe('');
  });

  test('notifies listeners on popstate', () => {
    const { windowStub, listeners, location } = createWindowStub(
      'http://example.com/milkdrop/',
    );
    const originalHref = location.href;
    const router = createRouter({
      windowRef: () => windowStub,
      queryParam: 'experience',
    });

    let observedRoute = null;
    router.listen((route) => {
      observedRoute = route;
    });

    windowStub.history.pushState({}, '', 'http://example.com/milkdrop/');
    listeners.get('popstate')?.();

    expect(observedRoute).toEqual({ view: 'experience', slug: 'milkdrop' });
    expect(router.getCurrentSlug()).toBe('milkdrop');

    windowStub.history.pushState({}, '', originalHref);
    listeners.get('popstate')?.();

    expect(router.getCurrentSlug()).toBe('milkdrop');
  });
});
