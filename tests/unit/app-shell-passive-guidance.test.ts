import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

    expect(audioMatch).not.toContain('stims-shell__audio-match-close');
    expect(audioMatch).not.toContain('aria-label="Dismiss"');
    // The toast owns its own dismiss timer (pausable on hover/focus so a
    // keyboard user can reach the action) rather than App holding a fixed
    // timeout — still no dismiss controls, still self-clears.
    expect(audioMatch).toMatch(
      /useEffect\(\(\) => \{\s*if \(!match \|\| held\) return;\s*const timer = window\.setTimeout\(\s*\(\) => onDismissRef\.current\(\),\s*AUTO_DISMISS_MS,?\s*\);/u,
    );
    expect(app).toContain('onDismiss={() => setAudioMatch(null)}');
  });

  test('keeps optional install and rotate notices non-blocking', () => {
    const app = frontendSource('App.tsx');

    expect(app).not.toContain('Not now');
    expect(app).not.toContain('Got it');
    expect(app).toContain(
      "localStorage.setItem('stims:rotate-hint-dismissed', 'true');",
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
