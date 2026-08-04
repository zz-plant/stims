import { expect, test } from 'bun:test';
import {
  buildGatePlan,
  parseExecutionMode,
  parseMode,
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
  expect(labels).toContain('Biome check');
  expect(labels).toContain('TypeScript typecheck');
  expect(plan.concurrent.length).toBeGreaterThanOrEqual(7);

  expect(plan.postflight).toHaveLength(0);
});

test('full gate plan runs the fast test suite after the concurrent lane', () => {
  const plan = buildGatePlan('full', 'parallel');

  expect(plan.postflight).toHaveLength(1);
  expect(plan.postflight[0].label).toBe('Fast test suite');
  expect(plan.postflight[0].cmd).toContain('test:fast');
});

test('all gate plan runs the complete test suite after the concurrent lane', () => {
  const plan = buildGatePlan('all', 'parallel');

  expect(plan.postflight).toHaveLength(1);
  expect(plan.postflight[0].label).toBe('Full test suite (all profiles)');
  expect(plan.postflight[0].cmd).toContain('test');
});
