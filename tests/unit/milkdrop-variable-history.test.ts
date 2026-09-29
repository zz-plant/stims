import { describe, expect, test } from 'bun:test';
import { createVariableHistory } from '../../src/js/milkdrop/variable-history.ts';
import {
  publishVariables,
  subscribeVariables,
} from '../../src/js/milkdrop/variable-probe.ts';

describe('variable history', () => {
  test('orders pinned, then q-vars numerically, then the rest', () => {
    const h = createVariableHistory();
    h.push({ zoom: 1, q10: 0, q2: 0, bass: 0, q1: 0 });
    h.togglePin('zoom');
    expect(h.rows().map((r) => r.name)).toEqual([
      'zoom',
      'q1',
      'q2',
      'q10',
      'bass',
    ]);
  });

  test('tracks min/max and marks only moving variables as changing', () => {
    const h = createVariableHistory();
    h.push({ a: 1, b: 5 });
    h.push({ a: 3, b: 5 });
    h.push({ a: -2, b: 5 });
    const rows = Object.fromEntries(h.rows().map((r) => [r.name, r]));
    expect(rows.a).toMatchObject({
      min: -2,
      max: 3,
      value: -2,
      changing: true,
    });
    expect(rows.b.changing).toBe(false);
    expect(h.rows({ onlyChanging: true }).map((r) => r.name)).toEqual(['a']);
  });

  test('caps history length and sanitises non-finite values', () => {
    const h = createVariableHistory(3);
    for (const v of [1, 2, 3, Number.NaN, 5]) h.push({ x: v });
    expect(h.rows()[0].history).toEqual([3, 0, 5]);
  });

  test('pins survive the filter and reset', () => {
    const h = createVariableHistory();
    h.push({ zoom: 1, rot: 2 });
    h.togglePin('zoom');
    expect(h.rows({ filter: 'rot' }).map((r) => r.name)).toEqual([
      'zoom',
      'rot',
    ]);
    h.reset();
    h.push({ zoom: 4 });
    expect(h.rows()[0]).toMatchObject({ name: 'zoom', pinned: true, value: 4 });
  });
});

describe('variable probe', () => {
  test('only delivers while subscribed', () => {
    const seen: number[] = [];
    publishVariables({ x: 1 });
    const off = subscribeVariables((v) => seen.push(v.x));
    publishVariables({ x: 2 });
    off();
    publishVariables({ x: 3 });
    expect(seen).toEqual([2]);
  });
});
