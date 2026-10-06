/**
 * test:budget's premise is that lowering bun's default timeout fails only the
 * tests that rely on it. These run the real audit over fixture tests, so a
 * bun release that changed how `--timeout` meets an explicit per-test timeout
 * would show up here rather than as a quietly wrong audit.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();

describe('test:budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stims-test-budget-fixture-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const fixture = join(dir, 'budget.test.ts');
  // Each slow test sleeps 8x the 50 ms budget used below, and load only makes
  // a sleep longer, so which side of the budget it lands on cannot flip.
  writeFileSync(
    fixture,
    [
      "import { describe, expect, test } from 'bun:test';",
      "describe('outer', () => {",
      "  describe('inner', () => {",
      "    test('leans on the default', () => Bun.sleep(400));",
      '  });',
      '});',
      "test('has its own budget', () => Bun.sleep(400), 30_000);",
      "test('quick', () => {});",
      "test('fails on its own', () => expect(1).toBe(2));",
      '',
    ].join('\n'),
  );

  // Three nested bun processes (audit, runner, bun test) plus the 400 ms
  // fixtures: well inside 5 s alone, but this file must not become the kind of
  // test it exists to find.
  test('lists only the slow test relying on the default timeout', () => {
    const run = Bun.spawnSync(
      ['bun', 'run', 'scripts/test-budget.ts', '--budget-ms', '50', fixture],
      { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
    );
    const out = run.stdout.toString() + run.stderr.toString();

    expect(run.exitCode).toBe(1);
    expect(out).toContain('1 test(s) rely on');
    expect(out).toContain('budget.test.ts:4');
    expect(out).toContain('outer > inner > leans on the default');
    expect(out).not.toContain('has its own budget');
    expect(out).not.toContain('quick');
    // An ordinary failure is counted, not reported as a budget finding.
    expect(out).toContain('1 test(s) failed for other reasons');
  }, 30_000);
});
