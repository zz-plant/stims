import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('pocket-pulse toy module', () => {
  test('exports a start function', () => {
    const source = readFileSync('assets/js/toys/pocket-pulse.ts', 'utf8');
    expect(source).toContain('export function start');
  });
});
