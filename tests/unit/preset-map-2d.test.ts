import { describe, expect, test } from 'bun:test';
import {
  barycentricWeights,
  nearestPoints,
  nearestThree,
} from '../../src/js/core/services/preset-map-2d.ts';

const pts = [
  { presetId: 'a', x: -1, y: -1 },
  { presetId: 'b', x: 1, y: -1 },
  { presetId: 'c', x: 0, y: 1 },
  { presetId: 'd', x: 5, y: 5 },
];

describe('preset map 2d', () => {
  test('nearestPoints sorts by distance', () => {
    const n = nearestPoints(pts, 0, 0, 2);
    expect(n.length).toBe(2);
    expect(n[0].presetId).toBe('c');
  });

  test('barycentricWeights at a vertex', () => {
    const w = barycentricWeights(pts[0], pts[1], pts[2], -1, -1);
    expect(w?.[0]).toBeCloseTo(1, 5);
    expect(w?.[1]).toBeCloseTo(0, 5);
    expect(w?.[2]).toBeCloseTo(0, 5);
  });

  test('barycentricWeights at centroid', () => {
    const w = barycentricWeights(pts[0], pts[1], pts[2], 0, -1 / 3);
    expect(w?.[0]).toBeCloseTo(1 / 3, 4);
    expect(w?.[1]).toBeCloseTo(1 / 3, 4);
    expect(w?.[2]).toBeCloseTo(1 / 3, 4);
  });

  test('nearestThree weights sum to 1', () => {
    const n = nearestThree(pts, 0, 0);
    expect(n.length).toBe(3);
    const sum = n.reduce((s, x) => s + x.weight, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  test('nearestThree empty points', () => {
    expect(nearestThree([], 0, 0)).toEqual([]);
  });
});
