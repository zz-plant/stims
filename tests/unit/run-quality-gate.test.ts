import { expect, test } from 'bun:test';
import {
  buildGatePlan,
  parseExecutionMode,
  parseMode,
  parseSkipTests,
} from '../../scripts/run-quality-gate.ts';

test('quick gate defaults to parallel execution', () => {
  expect(parseMode([])).toBe('full');
  expect(parseMode(['--quick'])).toBe('quick');
  expect(parseMode(['--all'])).toBe('all');
  expect(parseExecutionMode([])).toBe('parallel');
  expect(parseExecutionMode(['--serial'])).toBe('serial');
});

test('quick gate plan keeps tests out of the concurrent lane', () => {
  const plan = buildGatePlan('quick', 'parallel');

  expect(plan.preflight).toHaveLength(2);

  // The invariant is that nothing in the concurrent lane runs tests, not that
  // the lane holds one particular list. Pinning the list meant every new check
  // failed this test for no reason.
  for (const step of plan.concurrent) {
    expect(step.cmd.some((arg) => /^test(:|$)/.test(arg))).toBe(false);
  }

  // The lane is still expected to carry the checks the gate exists for.
  const labels = plan.concurrent.map((step) => step.label);
  expect(labels).toContain('Biome lint (changed files)');
  expect(labels).toContain('TypeScript typecheck');
  expect(plan.concurrent.length).toBeGreaterThanOrEqual(7);

  expect(plan.postflight).toHaveLength(0);
});

test('full gate plan runs the gate test suite after the concurrent lane', () => {
  const plan = buildGatePlan('full', 'parallel');

  expect(plan.postflight).toHaveLength(1);
  expect(plan.postflight[0].label).toBe('Gate test suite');
  // Not test:fast — corpus carries the parity and golden-snapshot tests, and
  // running them only in CI let a compiler change pass here and fail on push.
  expect(plan.postflight[0].cmd).toContain('test:gate');
});

test('--no-tests drops the suite without touching the checks', () => {
  expect(parseSkipTests([])).toBe(false);
  expect(parseSkipTests(['--no-tests'])).toBe(true);

  const full = buildGatePlan('full', 'parallel');
  const withoutTests = buildGatePlan('full', 'parallel', true);

  expect(withoutTests.postflight).toHaveLength(0);

  // The point of the flag is to move the suite to another CI job, not to
  // check less: every check the full gate runs must still run here.
  expect(withoutTests.preflight.map((step) => step.label)).toEqual(
    full.preflight.map((step) => step.label),
  );
  expect(withoutTests.concurrent.map((step) => step.label)).toEqual(
    full.concurrent.map((step) => step.label),
  );
});

test('the gate runs tests unless it is asked not to', () => {
  // A local `bun run check` passes no flags, so the default must keep the
  // suite: CI opting out must never become the behaviour everyone gets.
  expect(buildGatePlan('full', 'parallel').postflight).toHaveLength(1);
  expect(buildGatePlan('all', 'parallel').postflight).toHaveLength(1);
});

test('all gate plan runs the complete test suite after the concurrent lane', () => {
  const plan = buildGatePlan('all', 'parallel');

  expect(plan.postflight).toHaveLength(1);
  expect(plan.postflight[0].label).toBe('Full test suite (all profiles)');
  expect(plan.postflight[0].cmd).toContain('test');
});
