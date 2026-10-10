import { describe, expect, test } from 'bun:test';
import { SampleRing } from '../../src/js/milkdrop/sample-ring.ts';

/**
 * The ring is the render-path storage for every watched variable's history:
 * one write per frame, no reallocating slide (the `Array.shift` it replaced
 * was O(n) per frame per variable).
 */
describe('sample ring', () => {
  test('reads oldest → newest while filling, then wraps at capacity', () => {
    const ring = new SampleRing(4);
    for (const value of [1, 2, 3]) {
      ring.push(value);
    }
    expect(ring.count).toBe(3);
    expect([ring.at(0), ring.at(1), ring.at(2)]).toEqual([1, 2, 3]);
    expect(ring.newest()).toBe(3);

    ring.push(4);
    expect(ring.count).toBe(4);
    expect([ring.at(0), ring.at(1), ring.at(2), ring.at(3)]).toEqual([
      1, 2, 3, 4,
    ]);

    // Capacity is a hard bound: the fifth write drops the oldest sample,
    // not an error and not a ninth slot.
    ring.push(5);
    expect(ring.count).toBe(4);
    expect([ring.at(0), ring.at(1), ring.at(2), ring.at(3)]).toEqual([
      2, 3, 4, 5,
    ]);
    expect(ring.newest()).toBe(5);
  });

  test('sanitises nothing itself but reports an empty ring as zero', () => {
    const ring = new SampleRing(2);
    expect(ring.newest()).toBe(0);
    ring.push(Number.NaN);
    expect(ring.newest()).toBeNaN();
  });

  test('clear forgets samples but keeps the capacity for the next recording', () => {
    const ring = new SampleRing(2);
    ring.push(7);
    ring.clear();
    expect(ring.count).toBe(0);
    expect(ring.newest()).toBe(0);
    ring.push(8);
    ring.push(9);
    ring.push(10);
    expect(ring.count).toBe(2);
    expect([ring.at(0), ring.at(1)]).toEqual([9, 10]);
  });

  test('rejects capacities that are not positive integers', () => {
    expect(() => new SampleRing(0)).toThrow();
    expect(() => new SampleRing(-3)).toThrow();
    expect(() => new SampleRing(2.5)).toThrow();
  });
});
