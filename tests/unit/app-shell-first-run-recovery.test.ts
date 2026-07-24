import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell first-run and recovery regression', () => {
  test('surfaces a recoverable fallback when a preset link is missing from the build', () => {
    const appSource = readFileSync(
      join(import.meta.dir, '..', '..', 'assets', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );
    const uiSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'assets',
        'js',
        'frontend',
        'workspace-ui.tsx',
      ),
      'utf8',
    );
    const homeSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'assets',
        'js',
        'frontend',
        'NewHomePage.tsx',
      ),
      'utf8',
    );
    const shellHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'assets',
        'js',
        'frontend',
        'workspace-shell-hooks.ts',
      ),
      'utf8',
    );
    const sessionHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'assets',
        'js',
        'frontend',
        'workspace-hooks.ts',
      ),
      'utf8',
    );
    const toastHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'assets',
        'js',
        'frontend',
        'workspace-toast.ts',
      ),
      'utf8',
    );

    expect(appSource).toContain('<NewHomePage />');
    expect(homeSource).toContain('Browse presets');
    expect(homeSource).toContain('Featured preset');
    expect(uiSource).toContain('Link no longer works');
    expect(uiSource).toContain('invalidExperienceSlug');
    expect(shellHookSource).toMatch(
      /const missingRequestedPreset = Boolean\([\s\S]*?catalogReady[\s\S]*?\);/u,
    );
    expect(sessionHookSource).toContain(
      'const requestedPresetId = routePresetId',
    );
    expect(sessionHookSource).toContain(
      'resolvePresetId(engineSnapshot?.catalogEntries ?? [], routePresetId)',
    );
    expect(sessionHookSource).toContain(
      'pendingPresetIdRef.current = requestedPresetId',
    );
    expect(toastHookSource).toContain(
      'const unresolvedRequestedPreset = routeState.presetId',
    );
  });
});
