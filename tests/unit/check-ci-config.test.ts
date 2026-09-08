import { describe, expect, test } from 'bun:test';
/**
 * Tests for the CI config drift guard.
 *
 * A smoke test that the script runs clean against the current tree, plus the
 * category-coverage rules exercised against synthetic workflows. There is no
 * planted npm-leaking workflow case, whatever this comment used to claim.
 */
import { spawnSync } from 'node:child_process';
import { coveredTestCategories } from '../../scripts/check-ci-config.ts';

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

/**
 * The category-coverage rules, against synthetic workflows.
 *
 * The smoke test above cannot catch the failure mode this guard exists for:
 * it asserts the current tree is clean, and the guard was clean for two
 * reasons that had nothing to do with the jobs actually running.
 */
describe('test category coverage', () => {
  const SCRIPTS = {
    check: 'bun run scripts/run-quality-gate.ts',
    'test:fast': 'bun run scripts/run-tests.ts --profile fast',
    'test:gate': 'bun run scripts/run-tests.ts --profile gate',
    'test:corpus': 'bun run scripts/run-tests.ts --profile corpus',
  };

  test('a comment mentioning a command does not count as running it', () => {
    // This is how the guard came to pass while attributing nothing: two
    // comments in ci.yml said "bun run check", and that was enough to credit
    // the whole profile. Prose is not a job.
    const workflow = [
      'jobs:',
      '  build:',
      '    steps:',
      '      # The postflight half of `bun run check`, split onto its own runner.',
      '      - run: bun run build',
    ].join('\n');

    expect([...coveredTestCategories(workflow, SCRIPTS)]).toEqual([]);
  });

  test('a gate invoked with --no-tests covers nothing', () => {
    // ci.yml hands the suite to its own job and runs the checks only here.
    // Crediting this with the profile it would have run is how a deleted test
    // job could have gone unnoticed.
    const workflow = '      - run: bun run check -- --no-tests';

    expect([...coveredTestCategories(workflow, SCRIPTS)]).toEqual([]);
  });

  test('a gate invoked for real covers what its profile covers', () => {
    const workflow = '      - run: bun run check';

    expect([...coveredTestCategories(workflow, SCRIPTS)].sort()).toEqual([
      'compat',
      'corpus',
      'unit',
    ]);
  });

  test('the profile map mirrors run-tests, so every job is attributed', () => {
    // `gate` had no entry at all, so the one job covering unit and compat
    // contributed nothing to the tally it was supposed to satisfy.
    const workflow = '      - run: bun run test:gate';

    expect([...coveredTestCategories(workflow, SCRIPTS)].sort()).toEqual([
      'compat',
      'corpus',
      'unit',
    ]);
  });

  test('compat does not silently carry corpus with it', () => {
    // The map claimed compat included corpus; run-tests.ts has not agreed
    // since the parity job stopped duplicating it.
    const workflow = '      - run: bun run test:fast';

    expect([...coveredTestCategories(workflow, SCRIPTS)].sort()).toEqual([
      'compat',
      'unit',
    ]);
  });

  test('the shape this repo actually uses covers all four categories', () => {
    const workflow = [
      '      - run: bun run check -- --no-tests',
      '      - run: bun run test:fast',
      '      - run: bun run test:corpus',
      '      - run: bun test tests/e2e/${{ matrix.file }}',
    ].join('\n');

    expect([...coveredTestCategories(workflow, SCRIPTS)].sort()).toEqual([
      'compat',
      'corpus',
      'e2e',
      'unit',
    ]);
  });
});
