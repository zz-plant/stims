/**
 * lab:vj-baseline's regression pieces. The two regressions pinned here are
 * the ones that made the first version report nonsense: a penalised
 * intercept (every prediction pulled towards zero while zoom sits near 1)
 * and a clock basis that could not represent `sin(time)`.
 */
import { describe, expect, test } from 'bun:test';
import {
  audioDesign,
  audioR2,
  audioShare,
  clockDesign,
  ridgeSolver,
  rSquared,
  scenarioFold,
} from '../../scripts/preset-lab-vj-baseline.ts';

describe('ridgeSolver', () => {
  test('recovers exact coefficients when the penalty is negligible', () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      Float64Array.from([1, i / 10, Math.sin(i)]),
    );
    const target = Float64Array.from(
      rows,
      (row) => 3 + 2 * (row[1] as number) - 1.5 * (row[2] as number),
    );
    const [weights] = ridgeSolver(rows, 1e-9)([target]);
    expect(
      [...(weights as Float64Array)].map((w) => Math.round(w * 1000) / 1000),
    ).toEqual([3, 2, -1.5]);
  });

  test('never shrinks the intercept', () => {
    // A constant far from zero with a strong penalty: only an unpenalised
    // intercept can still predict it.
    const rows = Array.from({ length: 40 }, (_, i) =>
      Float64Array.from([1, Math.cos(i)]),
    );
    const target = new Float64Array(40).fill(1.05);
    const [weights] = ridgeSolver(rows, 10)([target]);
    expect(weights?.[0]).toBeCloseTo(1.05, 6);
  });

  test('solves several targets with one factorisation', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      Float64Array.from([1, i]),
    );
    const solve = ridgeSolver(rows, 0);
    const [a, b] = solve([
      Float64Array.from(rows, (row) => 2 * (row[1] as number)),
      Float64Array.from(rows, (row) => 5 - (row[1] as number)),
    ]);
    expect(a?.[1]).toBeCloseTo(2, 9);
    expect(b?.[0]).toBeCloseTo(5, 9);
  });
});

describe('design matrices', () => {
  test('the clock basis represents sin(time) exactly', () => {
    const clock = clockDesign(240, 60);
    const target = Float64Array.from(
      { length: 240 },
      (_, f) => 0.1 * Math.sin(f / 60),
    );
    const [weights] = ridgeSolver(clock, 0)([target]);
    const predicted = clock.map((row) =>
      row.reduce((sum, x, i) => sum + x * (weights?.[i] as number), 0),
    );
    expect(rSquared(target, predicted)).toBeCloseTo(1, 6);
  });

  test('audio rows carry standardised signals at each lag, clamped at the start', () => {
    // Two signals over five frames: s0 = frame index, s1 = constant 2.
    const signals = Float32Array.from([0, 2, 1, 2, 2, 2, 3, 2, 4, 2]);
    const rows = audioDesign(signals, 2, {
      mean: Float64Array.from([0, 0]),
      std: Float64Array.from([1, 1]),
    });
    expect(rows).toHaveLength(5);
    // Bias, then lag 0 (s0, s1), lag 4, lag 12, lag 30.
    expect([...(rows[4] as Float64Array)].slice(0, 5)).toEqual([1, 4, 2, 0, 2]);
    // Lags beyond the first frame clamp to frame 0.
    expect(rows[0]?.[5]).toBe(0);
  });
});

describe('rSquared', () => {
  test('is 1 for a perfect fit, 0 for the mean, null for a flat target', () => {
    const actual = Float64Array.from([1, 2, 3, 4]);
    expect(rSquared(actual, actual)).toBe(1);
    expect(rSquared(actual, Float64Array.from([2.5, 2.5, 2.5, 2.5]))).toBe(0);
    expect(
      rSquared(Float64Array.from([3, 3, 3]), Float64Array.from([1, 2, 3])),
    ).toBeNull();
  });
});

describe('scenarioFold', () => {
  test('the held-out scenario does not shape the training rows', () => {
    const clock = clockDesign(8, 60);
    const scenario = (scale: number) =>
      Float32Array.from({ length: 8 }, (_, f) => scale * Math.sin(f));
    const quiet = scenarioFold(
      [scenario(1), scenario(2), scenario(0.5)],
      1,
      clock,
      2,
    );
    const loud = scenarioFold(
      [scenario(1), scenario(2), scenario(100)],
      1,
      clock,
      2,
    );
    expect(loud.others).toEqual([0, 1]);
    expect(loud.train).toEqual(quiet.train);
    expect(loud.heldOut).not.toEqual(quiet.heldOut);
  });
});

describe('audioShare', () => {
  const t = Array.from({ length: 50 }, (_, f) => f / 10);
  test('clockwork (the same trajectory in every run) is 0', () => {
    const run = Float64Array.from(t, Math.sin);
    expect(audioShare([run, run, run])).toBeCloseTo(0, 12);
  });
  test('runs that differ only by a per-run level are fully audio-driven', () => {
    const runs = [0, 1, 2].map((k) => new Float64Array(50).fill(k));
    expect(audioShare(runs)).toBeCloseTo(1, 12);
  });
  test('a mix scores the between-run part of the variance', () => {
    // sin(t) shared by every run, plus a per-run offset of ±1
    const runs = [-1, 1].map((k) =>
      Float64Array.from(t, (x) => Math.sin(x) + k),
    );
    const clock = Float64Array.from(t, Math.sin);
    const mean = clock.reduce((a, b) => a + b, 0) / clock.length;
    const clockVar =
      clock.reduce((a, b) => a + (b - mean) ** 2, 0) / clock.length;
    expect(audioShare(runs)).toBeCloseTo(1 / (1 + clockVar), 6);
  });
});

describe('audioR2', () => {
  const actual = Float64Array.from({ length: 20 }, (_, f) => Math.sin(f));
  const oracle = new Float64Array(20);
  test('is 0 for the clock oracle, 1 for a perfect prediction, null with nothing to explain', () => {
    expect(audioR2([{ actual, predicted: oracle, oracle }])).toBe(0);
    expect(audioR2([{ actual, predicted: actual, oracle }])).toBe(1);
    expect(audioR2([{ actual: oracle, predicted: actual, oracle }])).toBeNull();
  });
  test('pools folds, so a quiet held-out scenario cannot dominate', () => {
    // fold A: the scenario departs strongly from the oracle and is mostly predicted;
    // fold B: it barely departs, and a small error would be −∞ on its own
    const quiet = Float64Array.from(actual, (v) => v * 1e-3);
    const pooled = audioR2([
      { actual, predicted: Float64Array.from(actual, (v) => v * 0.9), oracle },
      {
        actual: quiet,
        predicted: Float64Array.from(quiet, (v) => v + 0.01),
        oracle,
      },
    ]);
    expect(pooled).toBeGreaterThan(0.9);
    expect(
      audioR2([
        {
          actual: quiet,
          predicted: Float64Array.from(quiet, (v) => v + 0.01),
          oracle,
        },
      ]),
    ).toBe(-1);
  });
});
