import { expect, test } from 'bun:test';
import {
  buildGatePlan,
  parseExecutionMode,
  parseMode,
} from '../scripts/run-quality-gate.ts';

test('quick gate defaults to parallel execution', () => {
  expect(parseMode([])).toBe('full');
  expect(parseMode(['--quick'])).toBe('quick');
  expect(parseExecutionMode([])).toBe('parallel');
  expect(parseExecutionMode(['--serial'])).toBe('serial');
});

test('quick gate plan keeps tests out of the concurrent lane', () => {
  const plan = buildGatePlan('quick', 'parallel');

  expect(plan.preflight).toHaveLength(1);
  expect(plan.concurrent.map((step) => step.label)).toEqual([
    'Biome check',
    'Bundled catalog fidelity',
    'Toy manifest and docs drift',
    'SEO surface check',
    'Architecture boundary check',
    'TypeScript typecheck',
  ]);
  expect(plan.postflight).toHaveLength(0);
});

test('full gate plan runs the test suite after the quick lane', () => {
  const plan = buildGatePlan('full', 'parallel');

  expect(plan.postflight.map((step) => step.label)).toEqual(['Test suite']);
});
