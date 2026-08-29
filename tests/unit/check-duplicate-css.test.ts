import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

function runDuplicateCss(): number {
  const result = spawnSync('bun', ['run', 'scripts/check-duplicate-css.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  return result.status ?? 0;
}

describe('check-duplicate-css', () => {
  test('passes on the current repo', () => {
    expect(runDuplicateCss()).toBe(0);
  });
});
