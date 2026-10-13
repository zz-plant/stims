import { describe, expect, test } from 'bun:test';
import { parseArgs } from '../../scripts/run-tests.ts';

describe('scripts/run-tests.ts argument parsing', () => {
  test('a bare run is the fast profile, not every category', () => {
    // `bun run test` with no flags: the docs and `bun run help` promise
    // unit + compat. Falling through to `all` ran corpus and browser e2e.
    expect(parseArgs([]).profile).toBe('fast');
  });

  test('--changed and --watch keep the fast default', () => {
    expect(parseArgs(['--changed']).profile).toBe('fast');
    expect(parseArgs(['--watch']).profile).toBe('fast');
  });

  test('an explicit profile wins', () => {
    expect(parseArgs(['--profile', 'all']).profile).toBe('all');
    expect(parseArgs(['--changed', '--profile', 'gate']).profile).toBe('gate');
  });

  test('flag values are not mistaken for test files', () => {
    const parsed = parseArgs([
      '--',
      '--no-bail',
      '--timeout',
      '2500',
      '--junit-dir',
      'reports',
      'tests/unit/example.test.ts',
    ]);
    expect(parsed.explicitFiles).toEqual(['tests/unit/example.test.ts']);
    expect(parsed.profile).toBe('fast');
  });
});
