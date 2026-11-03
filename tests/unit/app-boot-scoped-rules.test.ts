// biome-ignore-all lint/suspicious/noExplicitAny: shell boot pokes browser globals and bun mocks that have no stable test-env types.

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act } from 'react';
import { flushTasks, importFresh } from '../test-helpers.ts';
// Loaded with the file so the boot under test does not also pay for the
// modules behind app.ts, as in app-shell.test.ts.
import 'react-dom/client';
import '../../src/js/frontend/workspace-router.tsx';

const originalFetch = globalThis.fetch;
const originalWindowFetch = window.fetch;

describe('booting on an engine without @scope', () => {
  afterEach(() => {
    (globalThis as any).__stimsAppDispose?.();
    delete (globalThis as any).__stimsAppDispose;
    delete (globalThis as any).__stimsLoaderOverrides;
    globalThis.fetch = originalFetch;
    window.fetch = originalWindowFetch;
    document.body.innerHTML = '';
  });

  // Mounting first lays the shell out without its rules, thousands of pixels
  // tall; on WebView 116 a focus call then left visitors at the page's bottom.
  test('mounts the shell only once the scoped rules are back', async () => {
    const seen: { mountStarted?: boolean } = {};
    const stubFetch = mock(async (url: unknown) => {
      if (!String(url).endsWith('/assets/app.css')) return { ok: false };
      return {
        ok: true,
        text: async () => {
          // app.ts sets this in the same tick as createRoot, so it says
          // whether the mount began, without racing React's render.
          seen.mountStarted = Boolean((globalThis as any).__stimsAppDispose);
          return '@scope (.stims-shell) { .item { order: 1; } }';
        },
      };
    }) as any;
    globalThis.fetch = stubFetch;
    window.fetch = stubFetch;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('href', 'https://example.com/assets/app.css');
    document.head.append(link);
    (globalThis as any).__stimsLoaderOverrides = {
      initNavigation: mock(),
      loadToy: mock(async () => {}),
      loadFromQuery: mock(),
    };

    await importFresh('../../src/js/app.ts');
    await act(async () => {
      await (globalThis as any).__stimsAppReady;
    });
    await flushTasks(10);

    expect(seen.mountStarted).toBe(false);
    expect(document.querySelector('.stims-shell__stage-frame')).not.toBeNull();
    expect(
      document.head.querySelector('[data-css-scope-fallback]')?.textContent,
    ).toContain(':where(.stims-shell) .item');
  }, 30000);
});
