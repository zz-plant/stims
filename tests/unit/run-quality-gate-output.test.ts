import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  type GateStepResult,
  parseOutputMode,
  printStepResult,
} from '../../scripts/run-quality-gate.ts';

const step = (exitCode: number, stdout = '', stderr = ''): GateStepResult => ({
  step: { label: 'Some guard', cmd: ['true'] } as GateStepResult['step'],
  exitCode,
  stdout,
  stderr,
  ms: 12,
});

describe('quality gate output mode', () => {
  test('humans and CI keep the full text by default', () => {
    expect(parseOutputMode(['--quick'], {})).toBe('text');
  });

  test('--quiet, STIMS_QUIET=1 and a Claude Code session select quiet', () => {
    expect(parseOutputMode(['--quiet'], {})).toBe('quiet');
    expect(parseOutputMode([], { STIMS_QUIET: '1' })).toBe('quiet');
    expect(parseOutputMode([], { CLAUDECODE: '1' })).toBe('quiet');
  });

  test('--verbose and STIMS_QUIET=0 win over the agent default', () => {
    expect(parseOutputMode(['--verbose'], { CLAUDECODE: '1' })).toBe('text');
    expect(parseOutputMode([], { CLAUDECODE: '1', STIMS_QUIET: '0' })).toBe(
      'text',
    );
  });

  test('--json wins over everything', () => {
    expect(parseOutputMode(['--json', '--quiet'], { CLAUDECODE: '1' })).toBe(
      'json',
    );
  });
});

describe('printing a step result', () => {
  const logged: string[] = [];
  const errored: string[] = [];
  const log = spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logged.push(a.join(' '));
  });
  const err = spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errored.push(a.join(' '));
  });
  afterEach(() => {
    logged.length = 0;
    errored.length = 0;
  });

  test('quiet mode collapses a passing step to one line and hides its output', () => {
    printStepResult(step(0, 'lots\nof\ncheck marks'), 'quiet');
    expect(logged).toEqual(['✓ Some guard (12ms)']);
    expect(errored).toEqual([]);
  });

  test('quiet mode keeps the full output of a failing step, header first', () => {
    printStepResult(step(1, 'stdout detail', 'stderr detail'), 'quiet');
    expect(logged[0]).toContain('✖ Some guard FAILED');
    expect(logged.join('\n')).toContain('stdout detail');
    expect(errored.join('\n')).toContain('stderr detail');
  });

  test('text mode still prints a passing step in full', () => {
    printStepResult(step(0, 'lots of detail'), 'text');
    expect(logged.join('\n')).toContain('==> Some guard (12ms)');
    expect(logged.join('\n')).toContain('lots of detail');
  });

  test('restores console', () => {
    log.mockRestore();
    err.mockRestore();
  });
});
