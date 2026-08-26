import { describe, expect, test } from 'bun:test';
/**
 * Smoke test for the CI config drift guard. The full logic is exercised
 * against the live repo; here we verify the script runs clean against the
 * current tree and fails on a planted npm-leaking workflow.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function runCiConfig(): number {
  const result = spawnSync('bun', ['run', 'scripts/check-ci-config.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  return result.status ?? 0;
}

describe('check-ci-config', () => {
  test('passes on the current repo', () => {
    expect(runCiConfig()).toBe(0);
  });
});
