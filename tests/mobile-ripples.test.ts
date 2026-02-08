import { describe, expect, test } from 'bun:test';
import { start } from '../assets/js/toys/mobile-ripples.ts';

describe('mobile-ripples toy module', () => {
  test('exports a start function', () => {
    expect(typeof start).toBe('function');
  });
});
