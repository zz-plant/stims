import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('mobile-ripples toy module', () => {
  test('exports a start function', () => {
    const source = readFileSync('assets/js/toys/mobile-ripples.ts', 'utf8');
    expect(source).toContain('export function start');
  });
});
