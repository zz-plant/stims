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

    expect(appSource).toContain('That saved link needs a new look.');
    expect(appSource).toContain('Requested look unavailable');
    expect(uiSource).toContain('Load featured look');
    expect(uiSource).toContain('Browse looks');
    expect(uiSource).toContain('Missing preset');
    expect(uiSource).toMatch(
      /This link points to a preset that is not bundled here[\s\S]*?library\./u,
    );
    expect(appSource).toMatch(
      /const missingRequestedPreset = Boolean\([\s\S]*?catalogReady[\s\S]*?\);/u,
    );
    expect(appSource).toMatch(
      /const stageSummary = missingRequestedPreset\s*\?/u,
    );
  });
});
