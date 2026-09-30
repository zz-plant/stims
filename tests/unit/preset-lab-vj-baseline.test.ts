/**
 * lab:vj-baseline's regression pieces. The two regressions pinned here are
 * the ones that made the first version report nonsense: a penalised
 * intercept (every prediction pulled towards zero while zoom sits near 1)
 * and a clock basis that could not represent `sin(time)`.
 */
import { describe, expect, test } from 'bun:test';
import {
  type AudioFeatures,
  audioDesign,
  audioR2,
  audioShare,
  clockDesign,
  eventF1,
  eventMatch,
  memoryGroup,
  memoryLookup,
  perFrameChange,
  ridgeSolver,
  rSquared,
  scenarioFold,
  summariseMemory,
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

describe('leaky features', () => {
  test("follow each lag with the standardised signal's leaky integrals", () => {
    // One signal: 0 on frame 0, then 1. With mean 0 and std 1 the τ=2
    // integral goes 0, 0.5, 0.75; τ=4 goes 0, 0.25, 0.4375.
    const rows = audioDesign(
      Float32Array.from([0, 1, 1]),
      1,
      { mean: Float64Array.from([0]), std: Float64Array.from([1]) },
      'leaky',
    );
    // Bias, four lags, then eight time constants.
    expect(rows[2]).toHaveLength(1 + 4 + 8);
    expect([...(rows[2] as Float64Array)].slice(5, 7)).toEqual([0.75, 0.4375]);
    expect([...(rows[1] as Float64Array)].slice(5, 7)).toEqual([0.5, 0.25]);
  });

  test('let the linear model follow a control that smooths its audio over seconds', () => {
    // The target is a 64-frame leaky average of the signal: memory the four
    // lags (up to 30 frames back) cannot hold.
    const frames = 600;
    const scenario = (seed: number) =>
      Float32Array.from({ length: frames }, (_, f) =>
        Math.max(0, Math.sin(f / (7 + seed)) + Math.sin(f / (23 + 5 * seed))),
      );
    const signals = [0, 1, 2, 3].map(scenario);
    const smoothed = signals.map((signal) => {
      let level = 0;
      return Float64Array.from(signal, (x) => (level += (x - level) / 64));
    });
    const clock = clockDesign(frames, 60);
    const heldOutR2 = (features: AudioFeatures) => {
      const fold = scenarioFold(signals, 1, clock, 3, features);
      const target = Float64Array.from(
        fold.others.flatMap((i) => Array.from(smoothed[i] as Float64Array)),
      );
      const [weights] = ridgeSolver(fold.train, 1e-4)([target]);
      const predicted = fold.heldOut.map((row) =>
        row.reduce((sum, x, i) => sum + x * (weights?.[i] as number), 0),
      );
      return rSquared(smoothed[3] as Float64Array, predicted) as number;
    };
    expect(heldOutR2('leaky')).toBeGreaterThan(0.95);
    expect(heldOutR2('leaky') - heldOutR2('lags')).toBeGreaterThan(0.1);
  });
});

test('perFrameChange differences a series and starts at 0', () => {
  expect([...perFrameChange(Float64Array.from([1, 3, 6, 6]))]).toEqual([
    0, 2, 3, 0,
  ]);
});

describe('memory classes from lab:memory-probe', () => {
  const lookup = memoryLookup([
    {
      id: 'probed',
      status: 'ok',
      columns: { zoom: { memory: 'instant' }, q1: { memory: 'persistent' } },
    },
    { id: 'broken', status: 'nan', columns: {} },
  ]);

  test('a measured column keeps its class; an unmoved one is gated', () => {
    expect(lookup('probed', 'zoom')).toBe('instant');
    expect(lookup('probed', 'q1')).toBe('persistent');
    expect(lookup('probed', 'q2')).toBe('gated');
  });

  test('a preset the probe could not run is unprobed, not gated', () => {
    expect(lookup('broken', 'zoom')).toBe('unprobed');
    expect(lookup('missing', 'zoom')).toBe('unprobed');
  });

  test('bounded memory ends within seconds; long, persistent and gated are stateful', () => {
    expect(
      (
        ['instant', 'short', 'seconds', 'long', 'persistent', 'gated'] as const
      ).map(memoryGroup),
    ).toEqual([
      'bounded',
      'bounded',
      'bounded',
      'stateful',
      'stateful',
      'stateful',
    ]);
    expect(memoryGroup('unprobed')).toBe('unprobed');
  });

  test("summaries report each group's median audio R² over its cells", () => {
    const summary = summariseMemory([
      { id: 'a', column: 'zoom', audioR2: 0.6, memory: 'instant' },
      { id: 'a', column: 'rot', audioR2: 0.4, memory: 'seconds' },
      { id: 'a', column: 'q1', audioR2: -0.1, memory: 'persistent' },
      { id: 'b', column: 'q1', audioR2: 0.9, memory: 'unprobed' },
    ]);
    expect(summary.bounded).toMatchObject({ cells: 2, medianAudioR2: 0.5 });
    expect(summary.stateful).toMatchObject({ cells: 1, medianAudioR2: -0.1 });
    expect(summary.byClass.unprobed).toMatchObject({
      cells: 1,
      medianAudioR2: 0.9,
    });
  });
});

describe('event timing', () => {
  // a toggle that flips at frames 10, 30 and 50
  const toggle = Float64Array.from(
    { length: 60 },
    (_, f) => [10, 30, 50].filter((at) => f >= at).length % 2,
  );

  test('a prediction that flips on the same frames scores 1, even from the other state', () => {
    const inverted = toggle.map((value) => 1 - value);
    expect(eventF1([eventMatch(toggle, inverted)])).toBe(1);
  });

  test('a flip within the tolerance counts; one far off does not', () => {
    const late = Float64Array.from(
      { length: 60 },
      (_, f) => [12, 30, 58].filter((at) => f >= at).length % 2,
    );
    expect(eventMatch(toggle, late)).toEqual({
      actual: 3,
      predicted: 3,
      hitActual: 2,
      hitPredicted: 2,
    });
    expect(eventF1([eventMatch(toggle, late)])).toBeCloseTo(2 / 3, 10);
  });

  test('a smooth prediction never jumps, so it finds no events', () => {
    const smooth = Float64Array.from({ length: 60 }, (_, f) => f / 60);
    expect(eventF1([eventMatch(toggle, smooth)])).toBe(0);
  });

  test('a column that never jumps has no event score', () => {
    const ramp = Float64Array.from({ length: 60 }, (_, f) => f);
    expect(eventF1([eventMatch(ramp, ramp)])).toBeNull();
  });

  test('counts pool across folds before F1', () => {
    const quiet = new Float64Array(60);
    expect(
      eventF1([eventMatch(toggle, toggle), eventMatch(quiet, quiet)]),
    ).toBe(1);
  });
});
