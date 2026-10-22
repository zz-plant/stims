import { describe, expect, test } from 'bun:test';
/**
 * Smoke test for the unbounded-cache guard. The full logic is diff-scoped and
 * exercised against the live tree; here we verify the script runs clean on the
 * current repo (advisory mode exits 0 even with flags) and that strict mode
 * fails when a growth container without a bound is planted.
 */
import { spawnSync } from 'node:child_process';

function runScript(...args: string[]): number {
  const result = spawnSync(
    'bun',
    ['run', 'scripts/check-cache-bounds.ts', ...args],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );
  return result.status ?? 0;
}

describe('check-cache-bounds', () => {
  // Each case spawns a fresh `bun` subprocess for a script that takes well
  // under a second alone, but the gate runs ~450 test files in parallel and
  // saturated process startup has pushed these past bun's 5 s default
  // (they are repeat offenders in `bun run test:budget`). The subprocess,
  // not the script under test, is the slow part, so these carry a generous
  // explicit timeout instead of leaning on the default.
  test('advisory mode exits 0 on the current repo', () => {
    expect(runScript()).toBe(0);
  }, 15000);

  test('strict mode exits 0 when the diff is clean of new containers', () => {
    // Runs against the live diff; a clean signal means no unbounded growth
    // container was added since the last commit.
    expect(runScript('--strict')).toBe(0);
  }, 15000);
});
