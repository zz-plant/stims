import { describe, expect, mock, test } from 'bun:test';

import { createRouter } from '../assets/js/core/router.ts';

function createMockLocation(href: string) {
  const url = new URL(href);
  return {
    get href() {
      return url.href;
    },
    set href(value: string) {
      url.href = new URL(value, url.href).href;
    },
    get search() {
      return url.search;
    },
    set search(value: string) {
      url.search = value;
    },
    get origin() {
      return url.origin;
    },
  };
}

function createMockHistory(locationObject: { href: string }) {
  return {
    pushState: (_state: unknown, _title: string, nextUrl: string | URL) => {
      const targetUrl = typeof nextUrl === 'string' ? new URL(nextUrl, locationObject.href) : nextUrl;
      locationObject.href = targetUrl.href;
    },
  };
}

function createMockWindow(href: string) {
  const listeners: Record<string, () => void> = {};
  const location = createMockLocation(href);
  return {
    location,
    history: createMockHistory(location),
    addEventListener: (type: string, callback: () => void) => {
      listeners[type] = callback;
    },
    trigger: (type: string) => listeners[type]?.(),
  };
}

describe('router', () => {
  test('pushToyState updates the query param', () => {
    const win = createMockWindow('http://example.com/library');
    const router = createRouter({ window: win });

    router.pushToyState('aurora-painter');

    expect(win.location.search).toBe('?toy=aurora-painter');
  });

  test('loadFromQuery dispatches to loaders and library handler', async () => {
    const win = createMockWindow('http://example.com/library?toy=aurora-painter');
    const loadToy = mock();
    const onLibraryRoute = mock();
    const router = createRouter({ window: win, loadToy, onLibraryRoute });

    await router.loadFromQuery();
    expect(loadToy).toHaveBeenCalledWith('aurora-painter');

    win.location.search = '';
    await router.loadFromQuery();
    expect(onLibraryRoute).toHaveBeenCalledTimes(1);
  });

  test('initNavigation registers popstate once', async () => {
    const win = createMockWindow('http://example.com/library?toy=aurora-painter');
    const loadToy = mock();
    const router = createRouter({ window: win, loadToy });

    router.initNavigation();
    router.initNavigation();

    win.trigger('popstate');
    expect(loadToy).toHaveBeenCalledWith('aurora-painter');
  });
});
