import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionRouteState } from '../../src/js/frontend/contracts.ts';
import type { EngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import { useWorkspaceToast } from '../../src/js/frontend/workspace-toast.ts';

describe('Workspace shell toast regression', () => {
  // The boot-time "lighter graphics mode" WebGL warning this test used to
  // assert was deliberately removed in 6f8db66c ("drop boot backend
  // toast") — it apologized to every mobile visitor over a stage that
  // hadn't painted yet. That's an intentional product decision, not a
  // regression, so this guards the decision instead of the deleted code:
  // no boot-time backend toast should come back, and the current
  // session-wide dedup mechanism (which generalized the old "only once"
  // guarantee to every runtime message, not just the WebGL warning) stays
  // in place.
  test('shows no boot-time backend warning toast', () => {
    const toastHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'workspace-toast.ts',
      ),
      'utf8',
    );

    expect(toastHookSource).not.toContain('webglWarningShownRef');
    expect(toastHookSource).not.toContain(
      'Using a lighter graphics mode so playback stays smooth.',
    );
    expect(toastHookSource).not.toMatch(/backend !== ['"]webgl['"]/u);
  });

  describe('which channel the toast shows', () => {
    // The hook is rendered for real; `flushSync` commits each prop change so
    // the assertion sees what the visitor would.
    let host: HTMLElement | null = null;
    let root: Root | null = null;
    afterEach(() => {
      root?.unmount();
      host?.remove();
      host = null;
      root = null;
    });

    const route: SessionRouteState = {
      presetId: null,
      collectionTag: null,
      panel: null,
      audioSource: null,
      agentMode: false,
    };
    const snapshotWith = (status: string | null) =>
      ({ status, catalogEntries: [] }) as unknown as EngineSnapshot;

    function mountToast() {
      let latest: string | null = null;
      let rerender: (props: {
        status: string | null;
        statusMessage: string | null;
      }) => void = () => {};
      function Host(props: {
        status: string | null;
        statusMessage: string | null;
      }) {
        const { toast } = useWorkspaceToast({
          engineSnapshot: snapshotWith(props.status),
          routeState: route,
          statusMessage: props.statusMessage,
        });
        latest = toast?.message ?? null;
        return null;
      }
      host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
      rerender = (props) => {
        act(() => {
          root?.render(createElement(Host, props));
        });
      };
      rerender({ status: null, statusMessage: null });
      return {
        set: (props: {
          status: string | null;
          statusMessage: string | null;
        }) => {
          rerender(props);
          return latest;
        },
      };
    }

    test('a runtime status shows once, not on every re-run with it still set', () => {
      const shown = mountToast();
      expect(shown.set({ status: 'Loaded Alpha.', statusMessage: null })).toBe(
        'Loaded Alpha.',
      );
      // Same status, new render for another reason: nothing new to say.
      // (The old session-wide "seen" set gave this guarantee; it also
      // swallowed everything below.)
      expect(shown.set({ status: 'Loaded Alpha.', statusMessage: null })).toBe(
        'Loaded Alpha.',
      );
      expect(shown.set({ status: 'Loaded Beta.', statusMessage: null })).toBe(
        'Loaded Beta.',
      );
    });

    test('a shell message does not shadow the runtime for the rest of the session', () => {
      // The shell's line is sticky: once Space had set "Paused…" nothing
      // ever cleared it, and `statusMessage ?? runtime` picked it forever —
      // no more "Loaded <preset>", blend refusals, or shader notices.
      const shown = mountToast();
      shown.set({ status: 'Loaded Alpha.', statusMessage: null });
      expect(
        shown.set({
          status: 'Loaded Alpha.',
          statusMessage: 'Paused. Press Space to resume.',
        }),
      ).toBe('Paused. Press Space to resume.');
      expect(
        shown.set({
          status: 'Loaded Beta.',
          statusMessage: 'Paused. Press Space to resume.',
        }),
      ).toBe('Loaded Beta.');
    });

    test('internal renderer diagnostics never become user toasts', () => {
      const shown = mountToast();
      expect(
        shown.set({
          status: 'WebGPU rollout flags active: compute-vm',
          statusMessage: null,
        }),
      ).toBeNull();
    });

    test('pausing twice says so twice', () => {
      const shown = mountToast();
      shown.set({
        status: null,
        statusMessage: 'Paused. Press Space to resume.',
      });
      expect(shown.set({ status: null, statusMessage: 'Resumed.' })).toBe(
        'Resumed.',
      );
      expect(
        shown.set({
          status: null,
          statusMessage: 'Paused. Press Space to resume.',
        }),
      ).toBe('Paused. Press Space to resume.');
    });
  });

  test('clears any active toast timer when dismissing a toast', () => {
    const toastHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'workspace-toast.ts',
      ),
      'utf8',
    );

    expect(toastHookSource).toContain('const clearToastTimer = () => {');
    expect(toastHookSource).toMatch(
      /showToast = useEffectEvent\([\s\S]*?clearToastTimer\(\);[\s\S]*?window\.setTimeout/u,
    );
    expect(toastHookSource).toMatch(
      /dismissToast:\s*\(\)\s*=>\s*\{[\s\S]*?clearToastTimer\(\);[\s\S]*?setToast\(null\);[\s\S]*?\}/u,
    );
  });
});
