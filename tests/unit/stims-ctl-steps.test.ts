import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  parseArgs,
  parsePostSpec,
  parseRunSpec,
} from '../../scripts/stims-ctl.ts';

describe('parseRunSpec', () => {
  test('a bare id has no params', () => {
    expect(parseRunSpec('next-preset')).toEqual({ id: 'next-preset' });
  });

  test('id=json splits at the first =, so the JSON may contain =', () => {
    expect(parseRunSpec('select-preset={"id":"a=b"}')).toEqual({
      id: 'select-preset',
      params: { id: 'a=b' },
    });
  });

  test('rejects an empty id, invalid JSON, and non-object params', () => {
    expect('error' in parseRunSpec('')).toBe(true);
    expect('error' in parseRunSpec('=')).toBe(true);
    expect(parseRunSpec('select-preset={bad')).toHaveProperty('error');
    expect(parseRunSpec('select-preset=[1]')).toEqual({
      error: 'params must be a JSON object',
    });
    expect(parseRunSpec('select-preset=null')).toEqual({
      error: 'params must be a JSON object',
    });
  });
});

describe('parsePostSpec', () => {
  test('accepts a toil:* message object', () => {
    expect(
      parsePostSpec('{"type":"toil:load_preset","presetId":"geiss-casino"}'),
    ).toEqual({
      message: { type: 'toil:load_preset', presetId: 'geiss-casino' },
    });
  });

  test('rejects invalid JSON, non-objects, and messages outside the protocol', () => {
    expect(parsePostSpec('{bad')).toHaveProperty('error');
    expect(parsePostSpec('[1]')).toEqual({ error: 'expected a JSON object' });
    expect(parsePostSpec('{"type":"load_preset"}')).toHaveProperty('error');
    expect(parsePostSpec('{"presetId":"x"}')).toHaveProperty('error');
  });
});

describe('parseArgs steps', () => {
  const exit = spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit(${code})`);
  }) as never);
  const err = spyOn(console, 'error').mockImplementation(() => {});
  afterEach(() => {
    exit.mockClear();
    err.mockClear();
  });

  test('--run and --wait-for keep the order they were given in', () => {
    const options = parseArgs([
      '--wait-for',
      's.catalogSize > 0',
      '--run',
      'select-preset={"id":"x"}',
      '--run',
      'next-preset',
      '--wait-for',
      's.presetId !== "x"',
    ]);
    expect(options.steps).toEqual([
      { kind: 'wait', expr: 's.catalogSize > 0' },
      { kind: 'run', id: 'select-preset', params: { id: 'x' } },
      { kind: 'run', id: 'next-preset' },
      { kind: 'wait', expr: 's.presetId !== "x"' },
    ]);
  });

  test('--post joins the ordered steps, and --embed is a flag', () => {
    const options = parseArgs([
      '--embed',
      '--post',
      '{"type":"toil:load_preset","presetId":"x"}',
      '--run',
      'next-preset',
      '--post',
      '{"type":"toil:request_telemetry"}',
    ]);
    expect(options.embed).toBe(true);
    expect(parseArgs([]).embed).toBe(false);
    expect(options.steps).toEqual([
      { kind: 'post', message: { type: 'toil:load_preset', presetId: 'x' } },
      { kind: 'run', id: 'next-preset' },
      { kind: 'post', message: { type: 'toil:request_telemetry' } },
    ]);
  });

  test('the step timeout defaults to 15s and can be set', () => {
    expect(parseArgs([]).stepTimeoutMs).toBe(15000);
    expect(parseArgs(['--step-timeout', '4000']).stepTimeoutMs).toBe(4000);
  });

  test('existing options are untouched by the new ones', () => {
    const options = parseArgs([
      '--preset',
      'p',
      '--shortcut',
      'shuffle',
      '--run',
      'next-preset',
    ]);
    expect(options.preset).toBe('p');
    expect(options.shortcuts).toEqual(['shuffle']);
    expect(options.steps).toHaveLength(1);
  });

  test('a malformed --run or empty --wait-for exits with usage instead of being ignored', () => {
    expect(() => parseArgs(['--run', 'select-preset={bad'])).toThrow('exit(1)');
    expect(() => parseArgs(['--wait-for', '  '])).toThrow('exit(1)');
    expect(() => parseArgs(['--post', '{"type":"nope"}'])).toThrow('exit(1)');
    expect(err.mock.calls.flat().join('\n')).toContain('Invalid --run');
  });

  test('restores process.exit', () => {
    exit.mockRestore();
    err.mockRestore();
  });
});
