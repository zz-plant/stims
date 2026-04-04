import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell first-run and recovery regression', () => {
  test('surfaces a recoverable fallback when a preset link is missing from the build', () => {
    const source = readFileSync(
      join(import.meta.dir, '..', 'assets', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );

    expect(source).toContain('That saved link needs a new look.');
    expect(source).toContain('Requested look unavailable');
    expect(source).toContain('Load featured look');
    expect(source).toContain('Browse looks');
    expect(source).toContain('Missing preset');
    expect(source).toMatch(
      /This link points to a preset that is not bundled here[\s\S]*?library\./u,
    );
    expect(source).toMatch(
      /const missingRequestedPreset = Boolean\([\s\S]*?catalogReady[\s\S]*?\);/u,
    );
    expect(source).toMatch(/const stageSummary = missingRequestedPreset\s*\?/u);
  });
});
