import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell first-run and recovery regression', () => {
  test('surfaces a recoverable fallback when a preset link is missing from the build', () => {
    const appSource = readFileSync(
      join(import.meta.dir, '..', 'assets', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );
    const uiSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
        'js',
        'frontend',
        'workspace-ui.tsx',
      ),
      'utf8',
    );
    const shellHookSource = readFileSync(
      join(
        import.meta.dir,
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
        'assets',
        'js',
        'frontend',
        'workspace-toast.ts',
      ),
      'utf8',
    );

    expect(appSource).toContain('Choose something new');
    expect(appSource).toContain(
      'Start with the featured pick or open the full list.',
    );
    expect(uiSource).toContain('Try featured pick');
    expect(uiSource).toContain('Browse everything');
    expect(uiSource).toContain('Saved pick not found');
    expect(uiSource).toContain("isn't available here anymore.");
    expect(uiSource).not.toContain('This preset is no longer bundled here.');
    expect(shellHookSource).toMatch(
      /const missingRequestedPreset = Boolean\([\s\S]*?catalogReady[\s\S]*?\);/u,
    );
    expect(sessionHookSource).toContain(
      'const shareableActivePresetId = resolvePresetId(',
    );
    expect(sessionHookSource).toContain('if (!shareableActivePresetId) {');
    expect(sessionHookSource).toContain('presetId: shareableActivePresetId');
    expect(toastHookSource).toContain(
      'const unresolvedRequestedPreset = routeState.presetId',
    );
  });
});
