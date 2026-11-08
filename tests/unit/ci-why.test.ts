import { expect, test } from 'bun:test';
import {
  extractFailureLines,
  formatReport,
  parseCiWhyArgs,
} from '../../scripts/ci-why.ts';

const LOG = [
  '2026-11-07T16:00:46.3701238Z ##[group]Run browser tests',
  '2026-11-07T16:00:46.3702006Z bun test v1.4.4',
  '2026-11-07T16:00:46.3702500Z \u001b[31m(pass) phone: each tap changes the preset [17802.70ms]\u001b[0m',
  '2026-11-07T16:00:46.3703000Z (fail) phone: one pick folds Browse [15270.06ms]',
  '2026-11-07T16:00:46.3704000Z error: expect(received).toBeLessThan(expected)',
  '2026-11-07T16:00:46.3705000Z Expected: < 6',
  '2026-11-07T16:00:46.3706000Z Received: 776.390625',
  '2026-11-07T16:00:46.3707000Z     at <anonymous> (/home/runner/work/stims/tests/e2e/step-budget.test.ts:277:46)',
  '2026-11-07T16:00:46.3708000Z     at async withPage (tests/e2e/step-budget.test.ts:103:11)',
  '2026-11-07T16:00:46.3709000Z     at async <anonymous> (tests/e2e/step-budget.test.ts:237:11)',
  '2026-11-07T16:00:46.3710000Z Ran 6 tests across 1 file. [169.88s]',
  '2026-11-07T16:00:46.3711000Z ##[endgroup]',
  '2026-11-07T16:00:46.3712000Z Cleaning up orphan processes',
].join('\n');

test('keeps the failure, the values, and the stack frames', () => {
  const lines = extractFailureLines(LOG);

  expect(lines).toEqual([
    '(fail) phone: one pick folds Browse [15270.06ms]',
    'error: expect(received).toBeLessThan(expected)',
    'Expected: < 6',
    'Received: 776.390625',
    '    at <anonymous> (/home/runner/work/stims/tests/e2e/step-budget.test.ts:277:46)',
    '    at async withPage (tests/e2e/step-budget.test.ts:103:11)',
    '    at async <anonymous> (tests/e2e/step-budget.test.ts:237:11)',
    'Ran 6 tests across 1 file. [169.88s]',
  ]);
});

test('drops setup noise, ANSI, timestamps, and a job prefix', () => {
  const lines = extractFailureLines(
    'job\tstep\t2026-11-07T16:00:46.3703000Z (fail) x [1ms]',
  );

  expect(lines).toEqual(['(fail) x [1ms]']);
});

test('caps the output so one noisy assertion cannot fill a context', () => {
  const noisy = Array.from(
    { length: 50 },
    (_, index) => `error: ${index}`,
  ).join('\n');

  expect(extractFailureLines(noisy, 3)).toHaveLength(3);
});

test('parses a run id, a PR, and the output options', () => {
  expect(parseCiWhyArgs(['42514407652'])).toEqual({
    runId: '42514407652',
    pr: undefined,
    json: false,
    maxLines: 40,
  });
  expect(
    parseCiWhyArgs(['--pr', '1689', '--json', '--max-lines', '80']),
  ).toEqual({
    runId: undefined,
    pr: '1689',
    json: true,
    maxLines: 80,
  });
  expect(parseCiWhyArgs(['--max-lines', 'nope']).maxLines).toBe(40);
});

test('reports a green run without inventing a failure', () => {
  const lines = formatReport(
    {
      databaseId: 1,
      conclusion: 'success',
      displayTitle: 'fix: a thing',
      headBranch: 'main',
      url: 'https://example.test/run/1',
    },
    [],
  );

  expect(lines.join('\n')).toContain('No failing jobs');
});

test('names the job, links it, and indents its failure lines', () => {
  const lines = formatReport(
    {
      databaseId: 1,
      conclusion: 'failure',
      displayTitle: 'fix: a thing',
      headBranch: 'main',
      url: 'https://example.test/run/1',
    },
    [
      {
        job: {
          databaseId: 2,
          name: 'Browser end-to-end tests (step-budget.test.ts)',
          conclusion: 'failure',
          url: 'https://example.test/job/2',
        },
        lines: ['(fail) phone: one pick', 'Expected: < 6'],
      },
    ],
  );

  expect(lines).toContain('✖ Browser end-to-end tests (step-budget.test.ts)');
  expect(lines).toContain('  https://example.test/job/2');
  expect(lines).toContain('  (fail) phone: one pick');
});
