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

    expect(appSource).toContain('Pick a preset');
    expect(appSource).toContain(
      'Start with the featured pick or open Presets.',
    );
    expect(uiSource).toContain('Load featured preset');
    expect(uiSource).toContain('Browse presets');
    expect(uiSource).toContain('Requested preset missing');
    expect(uiSource).toContain('is no longer bundled here.');
    expect(uiSource).not.toContain('This preset is no longer bundled here.');
    expect(shellHookSource).toMatch(
      /const missingRequestedPreset = Boolean\([\s\S]*?catalogReady[\s\S]*?\);/u,
    );
    expect(sessionHookSource).toContain(
      'const shareableActivePresetId = resolvePresetId(',
    );
    expect(sessionHookSource).toContain('if (!shareableActivePresetId) {');
    expect(sessionHookSource).toContain('presetId: shareableActivePresetId');
    expect(sessionHookSource).toContain(
      'const unresolvedRequestedPreset = routeState.presetId',
    );
  });
});
