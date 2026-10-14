/**
 * lab:memory-probe measures a preset's memory by re-running it with one
 * audio signal bumped. These tests pin the two things that make the number
 * trustworthy: an unbumped rerun is bit-identical (so any difference is the
 * bump's), and presets whose memory is known by construction land in the
 * right class.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import {
  CANONICAL_VARIABLES,
  runPresetForDataset,
} from '../../scripts/preset-lab-dataset.ts';
import {
  bumpFrames,
  measureResponse,
  memoryClass,
  type ProbeRow,
  probePreset,
  settleSignals,
  signalSpread,
} from '../../scripts/preset-lab-memory-probe.ts';
import { buildScenarioInputs } from '../../scripts/preset-lab-replay.ts';

// probePreset reruns its preset over every frame about ten times, so these
// tests share one probe of one preset holding every fixture, and keep the
// stimulus as short as the classes allow. The bump lands after 10 frames
// (the classes come out the same with it anywhere from frame 5 to 60), and 77
// frames follow it: the smoothed control's 40-frame upper bound plus the
// half-second tail that would mark it persistent. Nothing the probe reads
// depends on the warp mesh, so the fixture asks for the coarsest one, which
// takes about 40% off each VM step.
const frames = settleSignals(buildScenarioInputs('full-mix', 90));
const bump = { at: 10, length: 3 };
const fixture = (...lines: string[]) =>
  `[preset00]\nmesh_density=8\n${lines
    .map((line, i) => `per_frame_${i + 1}=${line}`)
    .join('\n')}\n`;

describe('bumpFrames', () => {
  const preset = fixture('zoom = 1 + 0.2*bass;');
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
    expect([9, 10, 12, 13].map(differs)).toEqual([false, true, true, false]);
  });
});

describe('probePreset', () => {
  // Each control reads one signal, so each column's response is the bump of
  // that signal alone.
  let columns: ProbeRow['columns'] = {};
  beforeAll(() => {
    columns = probePreset(
      fixture(
        'zoom = 1 + 0.2*bass;',
        'avg = avg*0.9 + 0.1*bass;',
        'q2 = avg;',
        'acc = acc + 0.01*bass;',
        'q1 = acc;',
        'q5 = beat;',
        'q6 = sin(time);',
      ),
      'fixture',
      [{ name: 'full-mix', frames }],
      bump,
    ).columns;
  });

  test('a control computed from this frame’s bass forgets the bump at once', () => {
    expect(columns.zoom).toMatchObject({
      memory: 'instant',
      nonlinearity: 0,
      signals: ['bass'],
    });
  });

  test('a smoothed control remembers it for seconds', () => {
    const q2 = columns.q2;
    expect(q2?.memory).toBe('seconds');
    // 0.9 per frame falls under 2% of the spread within about half a second
    // (27 frames). A tenfold change in that threshold moves it by ~22 frames
    // either way, so these bounds also pin the threshold.
    expect(q2?.memoryFrames).toBeGreaterThan(15);
    expect(q2?.memoryFrames).toBeLessThan(40);
  });

  test('an accumulator never forgets it', () => {
    expect(columns.q1).toMatchObject({
      memory: 'persistent',
      nonlinearity: 0,
    });
  });

  test('the beat probe injects a detected beat, which has no linearity', () => {
    expect(columns.q5).toMatchObject({
      memory: 'instant',
      nonlinearity: null,
      signals: ['beat'],
    });
  });

  test('a clock-driven control gets no column, and nothing else does', () => {
    expect(Object.keys(columns).sort()).toEqual(['q1', 'q2', 'q5', 'zoom']);
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
