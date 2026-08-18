import { describe, expect, test } from 'bun:test';
import { createSeededRandom } from '../../src/js/core/deterministic-random.ts';

describe('createSeededRandom', () => {
  test('same seed produces the same sequence', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  test('different seeds produce different sequences', () => {
    const a = createSeededRandom(1);
    const b = createSeededRandom(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  test('values stay within [0, 1)', () => {
    const rand = createSeededRandom(7);
    for (let i = 0; i < 200; i += 1) {
      const value = rand();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test('does not repeat trivially over a short window', () => {
    const rand = createSeededRandom(1234);
    const values = new Set(Array.from({ length: 50 }, () => rand()));
    // A degenerate generator (e.g. always 0, or a short cycle) would collapse
    // this set far below 50 distinct values.
    expect(values.size).toBeGreaterThan(45);
  });
});
