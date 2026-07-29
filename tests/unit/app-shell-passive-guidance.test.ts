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
    expect(app).toMatch(
      /useEffect\(\(\) => \{\s*if \(!audioMatch\) return;\s*const timeoutId = window\.setTimeout\(\(\) => setAudioMatch\(null\), 6000\);/u,
    );
  });

  test('keeps optional install, rotate, and renderer notices non-blocking', () => {
    const app = frontendSource('App.tsx');
    const rendererBadge = frontendSource('RendererFallbackBadge.tsx');

    expect(app).not.toContain('Not now');
    expect(app).not.toContain('Got it');
    expect(app).toContain(
      "localStorage.setItem('stims:rotate-hint-dismissed', 'true');",
    );
    expect(app).toContain(
      'window.setTimeout(() => setShowRotateHint(false), 4200)',
    );

    expect(rendererBadge).not.toContain('renderer-fallback-badge__dismiss');
    expect(rendererBadge).not.toContain('Dismiss WebGL fallback notice');
  });

  test('does not promote internal renderer diagnostics into user toasts', () => {
    const toastHook = frontendSource('workspace-toast.ts');

    expect(toastHook).toContain(
      "runtimeMessage.startsWith('WebGPU rollout flags active:')",
    );
  });
});
