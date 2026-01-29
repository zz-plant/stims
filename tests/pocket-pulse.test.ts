import { describe, expect, test } from 'bun:test';
import { start } from '../assets/js/toys/pocket-pulse.ts';

describe('pocket-pulse toy module', () => {
  test('exports a start function', () => {
    expect(typeof start).toBe('function');
  });
});
