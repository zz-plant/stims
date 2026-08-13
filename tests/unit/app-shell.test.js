import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { flushTasks, importFresh } from '../test-helpers.ts';

let mockLoadToy;
let mockLoadFromQuery;
let mockInitNavigation;
const originalFetch = globalThis.fetch;
const originalScreenDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'screen',
);

async function loadAppShell() {
  globalThis.__stimsLoaderOverrides = {
    initNavigation: mockInitNavigation,
    loadToy: mockLoadToy,
    loadFromQuery: mockLoadFromQuery,
  };

  await importFresh('../../src/js/app.ts');
  await globalThis.__stimsAppReady;
  await flushTasks(10);
}

describe('home shell user journeys', () => {
  beforeEach(() => {
    mock.restore();
    window.location.href = 'https://example.com/';
    globalThis.fetch = mock(async () => ({ ok: false }));
    Object.defineProperty(globalThis, 'screen', {
      configurable: true,
      value: window.screen ?? {
        orientation: {
          addEventListener() {},
          removeEventListener() {},
        },
      },
    });
    document.body.innerHTML = `
      <div data-top-nav-container></div>
      <div data-milkdrop-preset-count></div>
      <div data-milkdrop-preset-filters></div>
      <div data-milkdrop-preset-list></div>
    `;
    document.body.dataset.page = 'home';
    mockLoadToy = mock(async () => {});
    mockLoadFromQuery = mock();
    mockInitNavigation = mock();
  });

  afterEach(() => {
    globalThis.__stimsAppDispose?.();
    delete globalThis.__stimsAppDispose;
    mock.restore();
    globalThis.fetch = originalFetch;
    if (originalScreenDescriptor) {
      Object.defineProperty(globalThis, 'screen', originalScreenDescriptor);
    } else {
      delete globalThis.screen;
    }
    document.body.innerHTML = '';
    document.body.removeAttribute('data-page');
    delete globalThis.__stimsLoaderOverrides;
  });

  test('homepage stays on the root route and renders the editorial shell', async () => {
    await loadAppShell();

    const currentUrl = new URL(window.location.href);
    expect(currentUrl.pathname).toBe('/');
    expect(document.querySelector('.stims-shell__stage-frame')).not.toBeNull();
    expect(document.querySelector('.stims-shell__workspace')).not.toBeNull();
    expect(mockInitNavigation).not.toHaveBeenCalled();
    expect(mockLoadToy).not.toHaveBeenCalled();
    expect(mockLoadFromQuery).not.toHaveBeenCalled();
  });

  test('legacy landing query no longer changes the homepage boot model', async () => {
    window.location.href = 'https://example.com/?landing=1';

    await loadAppShell();

    expect(new URL(window.location.href).pathname).toBe('/');
    expect(new URL(window.location.href).searchParams.get('landing')).toBe('1');
    expect(mockLoadFromQuery).not.toHaveBeenCalled();
    expect(mockInitNavigation).not.toHaveBeenCalled();
    expect(mockLoadToy).not.toHaveBeenCalled();
  });

  test('shell cleanup cancels deferred full-catalog hydration', async () => {
    const originalWarn = console.warn;
    const warnMock = mock(() => {});
    const originalRequestIdleCallback = globalThis.requestIdleCallback;
    const originalCancelIdleCallback = globalThis.cancelIdleCallback;
    console.warn = warnMock;
    globalThis.requestIdleCallback = (callback) =>
      setTimeout(
        () =>
          callback({
            didTimeout: false,
            timeRemaining: () => 0,
          }),
        5000,
      );
    globalThis.cancelIdleCallback = (handle) => {
      if (handle) clearTimeout(handle);
    };

    try {
      await loadAppShell();

      expect(typeof globalThis.__stimsAppDispose).toBe('function');
      globalThis.__stimsAppDispose();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The guard here is that disposing the shell cancels the deferred
      // hydration instead of letting it fire into a torn-down shell. Attract
      // mode now mounts the engine on the bare landing view, so the catalog
      // fetch starts during this test and warns that the fixture is absent —
      // this environment serves no catalog. That warning says nothing about
      // cancellation, so assert on the warnings that would.
      const leakWarnings = warnMock.mock.calls.filter(
        ([first]) =>
          typeof first !== 'string' ||
          !first.startsWith('Optional catalog not found'),
      );
      expect(leakWarnings).toEqual([]);
    } finally {
      console.warn = originalWarn;
      if (originalRequestIdleCallback) {
        globalThis.requestIdleCallback = originalRequestIdleCallback;
      } else {
        delete globalThis.requestIdleCallback;
      }
      if (originalCancelIdleCallback) {
        globalThis.cancelIdleCallback = originalCancelIdleCallback;
      } else {
        delete globalThis.cancelIdleCallback;
      }
    }
  });
});
