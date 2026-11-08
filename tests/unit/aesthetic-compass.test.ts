import { describe, expect, test } from 'bun:test';
import {
  buildAestheticCompass,
  type CompassSample,
  MAX_COMPASS_POINTS,
} from '../../src/js/core/services/aesthetic-compass.ts';

function sample(id: string, values: number[]): CompassSample {
  return { presetId: id, vector: Float32Array.from(values) };
}

describe('buildAestheticCompass', () => {
  test('returns an empty compass for no samples', () => {
    const compass = buildAestheticCompass([], new Map());
    expect(compass.points).toEqual([]);
    expect(compass.nearestPreset(0, 0)).toBeNull();
  });

  test('projects every sample into [-1, 1]', () => {
    const samples = Array.from({ length: 40 }, (_, i) =>
      sample(`p${i}`, [Math.cos(i), Math.sin(i), i / 40, 1 - i / 40]),
    );
    const compass = buildAestheticCompass(samples, new Map());
    expect(compass.points).toHaveLength(40);
    for (const point of compass.points) {
      expect(point.x).toBeGreaterThanOrEqual(-1.0001);
      expect(point.x).toBeLessThanOrEqual(1.0001);
      expect(point.y).toBeGreaterThanOrEqual(-1.0001);
      expect(point.y).toBeLessThanOrEqual(1.0001);
    }
  });

  test('is deterministic for the same input', () => {
    const samples = Array.from({ length: 30 }, (_, i) =>
      sample(`p${i}`, [Math.sin(i * 0.7), Math.cos(i * 1.3), i % 3]),
    );
    const a = buildAestheticCompass(samples, new Map());
    const b = buildAestheticCompass(samples, new Map());
    expect(a.points).toEqual(b.points);
  });

  test('nearestPreset returns the closest projected point', () => {
    // Two tight clusters on a single axis, far apart.
    const samples: CompassSample[] = [];
    for (let i = 0; i < 20; i += 1) {
      samples.push(sample(`low${i}`, [1, 0, 0, i * 0.001]));
      samples.push(sample(`high${i}`, [0, 1, 0, i * 0.001]));
    }
    const compass = buildAestheticCompass(samples, new Map());
    const low = compass.points.find((p) => p.presetId === 'low0');
    const high = compass.points.find((p) => p.presetId === 'high0');
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    expect(compass.nearestPreset(low!.x, low!.y)).toStartWith('low');
    expect(compass.nearestPreset(high!.x, high!.y)).toStartWith('high');
  });

  test('orients the x axis so the geometric term sits on the positive side', () => {
    // Samples spread along one axis. Term vectors point the same way.
    const samples = Array.from({ length: 20 }, (_, i) =>
      sample(`p${i}`, [i, 0, 0, 0]),
    );
    const terms = new Map<string, ArrayLike<number>>([
      ['geometric', Float32Array.from([1, 0, 0, 0])],
      ['organic', Float32Array.from([-1, 0, 0, 0])],
    ]);
    const compass = buildAestheticCompass(samples, terms);
    // The sample with the largest first component should have positive x.
    const last = compass.points.find((p) => p.presetId === 'p19');
    expect(last).toBeDefined();
    expect(last!.x).toBeGreaterThan(0);
  });

  test('caps the number of rendered points', () => {
    const samples = Array.from({ length: MAX_COMPASS_POINTS + 50 }, (_, i) =>
      sample(`p${i}`, [i % 7, i % 5, 1]),
    );
    const compass = buildAestheticCompass(samples, new Map());
    expect(compass.points).toHaveLength(MAX_COMPASS_POINTS);
  });
});
