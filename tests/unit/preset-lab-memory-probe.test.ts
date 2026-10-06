/**
 * lab:memory-probe measures a preset's memory by re-running it with one
 * audio signal bumped. These tests pin the two things that make the number
 * trustworthy: an unbumped rerun is bit-identical (so any difference is the
 * bump's), and presets whose memory is known by construction land in the
 * right class.
 */
import { describe, expect, test } from 'bun:test';
import {
  CANONICAL_VARIABLES,
  runPresetForDataset,
} from '../../scripts/preset-lab-dataset.ts';
import {
  bumpFrames,
  measureResponse,
  memoryClass,
  probePreset,
  settleSignals,
  signalSpread,
} from '../../scripts/preset-lab-memory-probe.ts';
import { buildScenarioInputs } from '../../scripts/preset-lab-replay.ts';

// Each probe reruns the preset over every frame about ten times, so the
// stimulus is as short as the classes allow: a second for the signals to
// settle, then 87 frames, three times the smoothed control's memory plus the
// half-second tail that marks a response persistent.
const frames = settleSignals(buildScenarioInputs('full-mix', 150));
const bump = { at: 60, length: 3 };
const probe = (body: string) =>
  probePreset(
    `[preset00]\n${body}\n`,
    'fixture',
    [{ name: 'full-mix', frames }],
    bump,
  ).columns;

describe('bumpFrames', () => {
  const preset = '[preset00]\nper_frame_1=zoom = 1 + 0.2*bass;\n';
  const run = (input: typeof frames) =>
    runPresetForDataset(preset, 'fixture', input, CANONICAL_VARIABLES).states;

  test('a zero bump reproduces the run bit for bit', () => {
    const spread = signalSpread(frames);
    const zero = bumpFrames(frames, ['bass'], spread, bump, 0);
    expect(run(zero)).toEqual(run(frames));
  });

  test('a real bump changes only the frames it covers', () => {
    const spread = signalSpread(frames);
    const bumped = bumpFrames(frames, ['bass'], spread, bump, 0.5);
    const base = run(frames) as Float32Array;
    const changed = run(bumped) as Float32Array;
    const zoom = CANONICAL_VARIABLES.indexOf('zoom');
    const width = CANONICAL_VARIABLES.length;
    const differs = (f: number) =>
      changed[f * width + zoom] !== base[f * width + zoom];
    expect([59, 60, 62, 63].map(differs)).toEqual([false, true, true, false]);
  });
});

describe('probePreset', () => {
  test('a control computed from this frame’s bass forgets the bump at once', () => {
    expect(probe('per_frame_1=zoom = 1 + 0.2*bass;').zoom).toMatchObject({
      memory: 'instant',
      nonlinearity: 0,
      signals: ['bass'],
    });
  });

  test('a smoothed control remembers it for seconds', () => {
    const q2 = probe(
      'per_frame_1=avg = avg*0.9 + 0.1*bass;\nper_frame_2=q2 = avg;',
    ).q2;
    expect(q2?.memory).toBe('seconds');
    // 0.9 per frame falls under 2% of the spread within about half a second
    // (27 frames). A tenfold change in that threshold moves it by ~22 frames
    // either way, so these bounds also pin the threshold.
    expect(q2?.memoryFrames).toBeGreaterThan(15);
    expect(q2?.memoryFrames).toBeLessThan(40);
  });

  test('an accumulator never forgets it', () => {
    expect(
      probe('per_frame_1=acc = acc + 0.01*bass;\nper_frame_2=q1 = acc;').q1,
    ).toMatchObject({ memory: 'persistent', nonlinearity: 0 });
  });

  test('the beat probe injects a detected beat, which has no linearity', () => {
    expect(probe('per_frame_1=q5 = beat;').q5).toMatchObject({
      memory: 'instant',
      nonlinearity: null,
      signals: ['beat'],
    });
  });

  test('a clock-driven preset lists no columns', () => {
    expect(probe('per_frame_1=q6 = sin(time);')).toEqual({});
  });
});

describe('measureResponse', () => {
  const n = 100;
  const base = new Float64Array(n).map((_, f) => Math.sin(f));
  const withResponse = (response: (f: number) => number) =>
    Float64Array.from(base, (value, f) => value + response(f));
  const at = { at: 40, length: 3 };

  test('counts the frames the response outlasts the bump', () => {
    // Response 1 on frames 40..51: the bump ends at 42, so 9 frames more.
    const bumped = withResponse((f) => (f >= 40 && f < 52 ? 1 : 0));
    expect(measureResponse(base, bumped, null, at, 60)).toEqual({
      memoryFrames: 9,
      persistent: false,
      nonlinearity: null,
    });
  });

  test('marks a response still there at the end as persistent', () => {
    const bumped = withResponse((f) => (f >= 40 ? 0.5 : 0));
    expect(measureResponse(base, bumped, null, at, 60)?.persistent).toBe(true);
  });

  test('scores a response that quadruples when the bump doubles as nonlinear', () => {
    const step = (size: number) => (f: number) =>
      f >= 40 && f < 43 ? size : 0;
    const once = withResponse(step(1));
    expect(
      measureResponse(base, once, withResponse(step(2)), at, 60)?.nonlinearity,
    ).toBeCloseTo(0, 9);
    expect(
      measureResponse(base, once, withResponse(step(4)), at, 60)?.nonlinearity,
    ).toBeCloseTo(1, 9);
  });

  test('is null when the response stays under the threshold', () => {
    const bumped = withResponse((f) => (f === 40 ? 1e-4 : 0));
    expect(measureResponse(base, bumped, null, at, 60)).toBeNull();
  });
});

test('memoryClass boundaries at 60 fps', () => {
  expect(
    [0, 15, 16, 240, 241].map((frames) => memoryClass(frames, false, 60)),
  ).toEqual(['instant', 'short', 'seconds', 'seconds', 'long']);
  expect(memoryClass(0, true, 60)).toBe('persistent');
});
