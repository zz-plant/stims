import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useWorkspaceRouteState } from '../../src/js/frontend/workspace-hooks.ts';

describe('Workspace shell route sync regression', () => {
  let host: HTMLElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    root?.unmount();
    host?.remove();
    host = null;
    root = null;
    window.history.replaceState(null, '', '/');
  });

  test('commits interactive route updates synchronously so tool sheets can open immediately', () => {
    // Renders the real hook and commits a route inside flushSync. If
    // commitRoute deferred the update (startTransition was the original
    // regression: the sheet opened a frame late), the DOM would still show
    // the old panel when flushSync returns — a transition scheduled inside
    // flushSync is not flushed by it.
    let commit: ((next: { panel: string | null }) => void) | null = null;

    function Host() {
      const { commitRoute, routeState } = useWorkspaceRouteState();
      commit = commitRoute as unknown as typeof commit;
      return createElement('output', null, routeState.panel ?? 'none');
    }

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    flushSync(() => {
      root?.render(createElement(Host));
    });
    expect(host.textContent).toBe('none');

    flushSync(() => {
      commit?.({ panel: 'settings' });
    });
    expect(host.textContent).toBe('settings');
  });

  test('a panel close committed in the same tick as a preset change keeps the newer preset', () => {
    // Backspace with Browse open used to do both at once: the shell went to
    // the previous preset while a synthetic Escape closed the sheet, and the
    // close was committed as `{ ...routeState, panel: null }` from the
    // render before the preset moved — putting the old preset straight
    // back. commitRoute takes an updater so each handler changes only what
    // it owns.
    let commit:
      | ((
          next:
            | { presetId: string | null; panel: string | null }
            | ((current: { presetId: string | null; panel: string | null }) => {
                presetId: string | null;
                panel: string | null;
              }),
        ) => void)
      | null = null;

    function Host() {
      const { commitRoute, routeState } = useWorkspaceRouteState();
      commit = commitRoute as unknown as typeof commit;
      return createElement(
        'output',
        null,
        `${routeState.presetId ?? 'none'}/${routeState.panel ?? 'none'}`,
      );
    }

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    flushSync(() => {
      root?.render(createElement(Host));
    });
    flushSync(() => {
      commit?.((current) => ({ ...current, presetId: 'a', panel: 'browse' }));
    });
    expect(host.textContent).toBe('a/browse');

    flushSync(() => {
      commit?.((current) => ({ ...current, presetId: 'b' }));
      commit?.((current) => ({ ...current, panel: null }));
    });
    expect(host.textContent).toBe('b/none');
  });

  test('marks the shell when a toast is visible so mobile layouts can reserve space', () => {
    // Cross-artifact presentational contract: the attribute App.tsx sets and
    // the media-query rule that consumes it. jsdom/happy-dom computes neither
    // media queries nor layout, so the CSS half has no behavioural
    // observation point in this suite.
    const appSource = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );
    const cssSource = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'css', 'app-shell.css'),
      'utf8',
    );

    expect(appSource).toMatch(
      /data-has-toast=\{(?:ui|w)\.toast \? 'true' : undefined\}/u,
    );
    expect(cssSource).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell\[data-has-toast="true"\]\s*\{\s*padding-bottom:\s*calc\(96px \+ env\(safe-area-inset-bottom\)\);/u,
    );
  });
});
