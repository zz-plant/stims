import { describe, expect, jest, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioMatchToast } from '../../src/js/frontend/AudioMatchToast.tsx';

function frontendSource(file: string) {
  return readFileSync(
    join(import.meta.dir, '..', '..', 'src', 'js', 'frontend', file),
    'utf8',
  );
}

describe('passive first-use guidance', () => {
  test('lets transient guidance clear itself without dismissal controls', () => {
    const app = frontendSource('App.tsx');
    const audioMatch = frontendSource('AudioMatchToast.tsx');
    const contextualHelp = frontendSource('ContextualHelp.tsx');
    const toast = frontendSource('WorkspaceToast.tsx');
    const workspaceUi = frontendSource('workspace-ui.tsx');

    expect(toast).not.toContain('stims-shell__toast-dismiss');
    expect(toast).not.toContain('Dismiss');
    expect(workspaceUi).toContain('<WorkspaceToast toast={ui.toast} />');

    expect(contextualHelp).not.toContain('aria-label="Dismiss hint"');
    expect(contextualHelp).not.toContain('closeButton');
    expect(app).toContain('<ContextualHelp hint={visibleHint} />');

    expect(app).toContain('onDismiss={() => setAudioMatch(null)}');
  });

  test('the audio-match toast self-clears, pauses while held, and has no dismiss control', () => {
    // Renders the real component with fake timers instead of regex-matching
    // its effect body. The behaviour under guard: it dismisses itself after
    // its own timeout, the timer pauses while hovered or focused (a fixed
    // deadline expires before a keyboard user can Tab to the action), and
    // there is no dismiss button to click.
    (
      globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let dismissed = 0;
    const render = () =>
      act(() =>
        root.render(
          createElement(AudioMatchToast, {
            match: { presetId: 'p', name: 'Match', score: 0.9 },
            onSelect: () => {},
            onDismiss: () => {
              dismissed += 1;
            },
          }),
        ),
      );

    render();
    const toast = container.querySelector('.stims-shell__audio-match');
    expect(toast).not.toBeNull();
    // No dismiss affordance anywhere in the rendered output.
    expect(container.querySelector('[aria-label="Dismiss"]')).toBeNull();
    expect(
      container.querySelector('.stims-shell__audio-match-close'),
    ).toBeNull();

    // Held toasts do not expire... (pointerover, not pointerenter: enter
    // does not bubble, and React listens at the root and derives
    // onPointerEnter from over/out pairs)
    act(() => {
      toast?.dispatchEvent(new Event('pointerover', { bubbles: true }));
    });
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(dismissed).toBe(0);

    // ...and releasing restarts the clock, after which it self-clears.
    act(() => {
      toast?.dispatchEvent(new Event('pointerout', { bubbles: true }));
    });
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(dismissed).toBe(1);

    act(() => root.unmount());
    container.remove();
    jest.useRealTimers();
  });

  test('keeps optional install and rotate notices non-blocking', () => {
    const app = frontendSource('App.tsx');

    expect(app).not.toContain('Not now');
    expect(app).not.toContain('Got it');
    // Asserts the behaviour (the hint is remembered so it shows once), not
    // the call spelling. Pinning the literal `localStorage.setItem(...)` made
    // this guard fail the moment those writes moved behind a safe-storage
    // helper, even though nothing about the behaviour changed.
    expect(app).toContain("readStored('stims:rotate-hint-dismissed')");
    expect(app).toMatch(
      /(?:localStorage\.setItem|writeStored)\(\s*'stims:rotate-hint-dismissed',\s*'true'/,
    );
    expect(app).toContain(
      'window.setTimeout(() => setShowRotateHint(false), 4200)',
    );
  });

  test('does not promote internal renderer diagnostics into user toasts', () => {
    const toastHook = frontendSource('workspace-toast.ts');

    expect(toastHook).toContain(
      "runtimeMessage.startsWith('WebGPU rollout flags active:')",
    );
  });
});
