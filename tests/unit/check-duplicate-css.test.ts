import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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

  test('the guard script exists', () => {
    expect(existsSync('scripts/check-duplicate-css.ts')).toBe(true);
  });
});
