/**
 * test:budget predicts each test's wall time under load from the CPU it
 * burns, and fails only tests on bun's default timeout. The end-to-end case
 * runs the real audit over fixture tests whose CPU is fixed (they spin until
 * process.cpuUsage() says so), so the verdict cannot move with machine load;
 * the rest pin the pieces that verdict rests on.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type JunitCase,
  pairCosts,
  readJunitCases,
  survivableLoad,
  testCallSite,
  testCalls,
} from '../../scripts/test-budget.ts';
import type { TestCostRecord } from '../../scripts/test-cost-recorder.ts';

const ROOT = process.cwd();

describe('test:budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stims-test-budget-fixture-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const fixture = join(dir, 'budget.test.ts');
  const spin = (ms: number) =>
    `{ const t = process.cpuUsage(); while (process.cpuUsage(t).user < ${ms * 1000}) {} }`;
  writeFileSync(
    fixture,
    [
      "import { describe, expect, test } from 'bun:test';",
      "describe('outer', () => {",
      "  describe('inner', () => {",
      `    test('burns on the default', () => ${spin(300)});`,
      '  });',
      '});',
      "test('burns in a child on the default', () => {",
      `  Bun.spawnSync(['bun', '-e', ${JSON.stringify(spin(300))}]);`,
      '});',
      "test('sleeps on the default', () => Bun.sleep(400));",
      `test('burns under its own timeout', () => ${spin(300)}, 6_000);`,
      "test('quick', () => {});",
      "test('fails on its own', () => expect(1).toBe(2));",
      '',
    ].join('\n'),
  );

  // Three nested bun processes plus ~1 s of fixture CPU: well inside 5 s
  // alone, but under load this file is the kind of test it exists to find.
  test('fails the CPU-bound tests on the default, and only those', () => {
    // A load at which the default timeout allows 50 ms of CPU on any core
    // count: 5000 ms × cores / (3 × load) = 50.
    const load = Math.ceil((5000 * availableParallelism()) / (3 * 50));
    const run = Bun.spawnSync(
      ['bun', 'run', 'scripts/test-budget.ts', '--load', String(load), fixture],
      { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
    );
    const out = run.stdout.toString() + run.stderr.toString();
    const failing = out.slice(
      out.indexOf("on bun's 5 s default would overrun"),
      out.indexOf('with their own or an unread timeout would also'),
    );
    const ownTimeout = out.slice(
      out.indexOf('with their own or an unread timeout would also'),
    );

    expect(run.exitCode).toBe(1);
    expect(out).toContain('2 test(s)');
    expect(failing).toContain('budget.test.ts:4');
    expect(failing).toContain('outer > inner > burns on the default');
    // Its CPU is in a subprocess, which only getrusage(RUSAGE_CHILDREN) sees.
    expect(failing).toContain('burns in a child on the default');
    // 400 ms of sleep is wait, not CPU: load does not stretch it.
    expect(failing).not.toContain('sleeps on the default');
    // Judged against its own 6 s, and reported rather than failed.
    expect(failing).not.toContain('burns under its own timeout');
    expect(ownTimeout).toContain('burns under its own timeout');
    expect(ownTimeout).toContain('timeout 6,000');
    expect(out).toContain('1 test(s) failed');
  }, 30_000);
});

describe('readJunitCases', () => {
  test('reads tests in run order with their describe path and outcome', () => {
    const xml = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="a.test.ts" file="a.test.ts">
    <testsuite name="outer" file="a.test.ts">
      <testcase name="passes" classname="outer" time="0.25" file="a.test.ts" line="3" />
      <testcase name="times out" classname="outer" time="5.1" file="a.test.ts" line="4">
        <failure type="TimeoutError" message="timed out" />
      </testcase>
    </testsuite>
    <testcase name="is skipped" time="0" file="a.test.ts"><skipped /></testcase>
    <testcase name="it&apos;s wrong" time="0.01" file="a.test.ts">
      <failure type="AssertionError" message="no" />
    </testcase>
  </testsuite>
</testsuites>`;
    expect(readJunitCases(xml)).toEqual([
      {
        file: 'a.test.ts',
        line: '3',
        name: 'outer > passes',
        wallMs: 250,
        status: 'pass',
      },
      {
        file: 'a.test.ts',
        line: '4',
        name: 'outer > times out',
        wallMs: 5100,
        status: 'timeout',
      },
      {
        file: 'a.test.ts',
        line: '',
        name: 'is skipped',
        wallMs: 0,
        status: 'skip',
      },
      {
        file: 'a.test.ts',
        line: '',
        name: "it's wrong",
        wallMs: 10,
        status: 'fail',
      },
    ]);
  });
});

describe('pairCosts', () => {
  const ran = (file: string, name: string, status: JunitCase['status']) => ({
    file,
    line: '',
    name,
    wallMs: 1,
    status,
  });
  const cost = (
    file: string,
    index: number,
    selfCpuMs: number,
    setupCpuMs?: number,
  ): TestCostRecord => ({
    file,
    index,
    selfCpuMs,
    childCpuMs: 0,
    wallMs: selfCpuMs,
    ...(setupCpuMs === undefined ? {} : { setupCpuMs }),
  });

  test('gives the nth record of a file to its nth test that ran', () => {
    const { tests, setupCpuMs, unpaired } = pairCosts(
      [
        ran('tests/a.test.ts', 'first', 'pass'),
        ran('tests/a.test.ts', 'skipped', 'skip'),
        ran('tests/a.test.ts', 'second', 'fail'),
      ],
      // Records arrive in any order across workers.
      [cost('tests/a.test.ts', 1, 20), cost('tests/a.test.ts', 0, 10, 99)],
    );
    expect(tests.map((t) => [t.name, t.selfCpuMs])).toEqual([
      ['first', 10],
      ['second', 20],
    ]);
    expect(setupCpuMs.get('tests/a.test.ts')).toBe(99);
    expect(unpaired).toEqual([]);
  });

  test('leaves a file unpaired when its counts disagree', () => {
    const { tests, unpaired } = pairCosts(
      [ran('a.test.ts', 'one', 'pass'), ran('a.test.ts', 'two', 'pass')],
      [cost('a.test.ts', 0, 10)],
    );
    expect(tests).toEqual([]);
    expect(unpaired).toEqual(['a.test.ts']);
  });
});

describe('testCallSite', () => {
  const source = [
    "const SLOW_MS: number = 30 * 1000; // a test('fake', () => {}) in a comment",
    "test('default', () => {",
    '  expect(/\\)/.test(")")).toBe(true);',
    '  render(<Panel open={true} />);',
    '});',
    "test('literal', () => {}, 30_000);",
    "test('named', () => {}, SLOW_MS);",
    "it('options', () => {}, { timeout: 12_000 });",
    'for (const id of ids) {',
    '  test(`${id} still moves`, () => {}, 45_000);',
    '}',
    "test.each([1, 2])('case %d', () => {}, 7_000);",
    "test('alpha still moves', () => {});",
    "test('computed', () => {}, Math.max(1, 2));",
  ].join('\n');
  const calls = testCalls(source);
  const timeoutOf = (name: string) => testCallSite(calls, name).timeout;

  test('reads literal, const, option and missing timeouts', () => {
    expect(timeoutOf('default')).toBe('default');
    expect(timeoutOf('literal')).toBe(30_000);
    expect(timeoutOf('named')).toBe(30_000);
    expect(timeoutOf('options')).toBe(12_000);
    expect(testCallSite(calls, 'literal').line).toBe(6);
  });

  test('maps a looped or .each name back to its one call', () => {
    expect(timeoutOf('beta still moves')).toBe(45_000);
    expect(timeoutOf('case 2')).toBe(7_000);
    // A literal name wins over a pattern that also matches it.
    expect(timeoutOf('alpha still moves')).toBe('default');
  });

  test('says unknown rather than guess', () => {
    expect(timeoutOf('computed')).toBe('unknown');
    expect(timeoutOf('nowhere in the file')).toBe('unknown');
  });
});

describe('survivableLoad', () => {
  test('is where cpu stretched by load, plus wait, reaches the timeout', () => {
    // 500 ms CPU against 5 s on 10 cores: 10x headroom / (3 per load/core).
    expect(
      survivableLoad({ cpuMs: 500, waitMs: 0, timeoutMs: 5000, cores: 10 }),
    ).toBeCloseTo(33.3, 1);
    // Wait eats headroom but does not stretch.
    expect(
      survivableLoad({ cpuMs: 500, waitMs: 2500, timeoutMs: 5000, cores: 10 }),
    ).toBeCloseTo(16.7, 1);
    expect(
      survivableLoad({ cpuMs: 0, waitMs: 400, timeoutMs: 5000, cores: 10 }),
    ).toBe(Number.POSITIVE_INFINITY);
    expect(
      survivableLoad({ cpuMs: 6000, waitMs: 0, timeoutMs: 5000, cores: 10 }),
    ).toBe(0);
  });
});
