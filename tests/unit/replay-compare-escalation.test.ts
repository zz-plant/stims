/**
 * Unit cover for compareReplay's digest-mismatch escalation.
 *
 * A compact golden trace stores variables on checkpoint frames only, but the
 * live replay always captures them. When the digests disagree — which is what
 * a machine with a different libm produces — the comparison escalates to a
 * field diff, and that diff used to pit the replay's real values against the
 * `undefined` the compact frame never stored, reading it as 0 and reporting
 * every variable in the preset as moved.
 *
 * That made the escalation unusable on precisely the frames it exists for, so
 * the gate stayed pinned to whichever machine recorded the traces even after
 * tolerances were added. Skipping variables there outright went too far the
 * other way: a zoom that moved for a few frames between checkpoints passed.
 * Compact frames now carry a variable summary (sum and absolute sum) that
 * the escalation compares under the same tolerance. These cases are cheap and
 * VM-free, so the property is pinned independently of the witness presets.
 */
import { describe, expect, test } from 'bun:test';
import {
  compareReplay,
  summarizeVariables,
  type TraceFile,
} from '../../scripts/preset-lab-replay.ts';

const geometry = { mainWave: 1.5, customWaves: 2.5, shapes: 3.5 };

function traceOf(frames: unknown[]): TraceFile {
  return {
    version: 1,
    presetId: 'test-preset',
    capturedAt: '',
    fps: 60,
    scenario: 'full-mix',
    frames,
  } as unknown as TraceFile;
}

describe('compareReplay digest-mismatch escalation', () => {
  test('compares the summary, not the variables the compact frame dropped', () => {
    const variables = { zoom: 1.05, rot: 0.02 };
    const trace = traceOf([
      {
        digest: 'aaaaaaaa',
        variableSummary: summarizeVariables(variables),
        geometry,
      },
    ]);
    const replayed = [
      {
        digest: 'bbbbbbbb', // differing libm: the digest cannot match
        variables: { zoom: 1.0500000000000003, rot: 0.02 }, // 1 ULP
        geometry,
      },
    ] as never;

    expect(compareReplay(trace, replayed)).toBeNull();
  });

  test('catches a variable that moved between checkpoints with geometry unchanged', () => {
    // The transient case the summary exists for: zoom is off for one
    // non-checkpoint frame and the wave/shape checksums do not see it.
    const trace = traceOf([
      {
        digest: 'aaaaaaaa',
        variableSummary: summarizeVariables({ zoom: 1.05, rot: 0.02 }),
        geometry,
      },
    ]);
    const replayed = [
      { digest: 'bbbbbbbb', variables: { zoom: 1.06, rot: 0.02 }, geometry },
    ] as never;

    const divergence = compareReplay(trace, replayed);
    expect(divergence?.frame).toBe(0);
    expect(divergence?.details.join('\n')).toContain('variables (sum of all');
  });

  test('a compact frame recorded before summaries existed falls back to geometry', () => {
    const trace = traceOf([{ digest: 'aaaaaaaa', geometry }]);
    const replayed = [
      { digest: 'bbbbbbbb', variables: { zoom: 1.06 }, geometry },
    ] as never;

    expect(compareReplay(trace, replayed)).toBeNull();
  });

  test('still reports geometry that actually moved on such a frame', () => {
    const trace = traceOf([{ digest: 'aaaaaaaa', geometry }]);
    const replayed = [
      {
        digest: 'bbbbbbbb',
        variables: { zoom: 1.05 },
        geometry: { ...geometry, shapes: 99 },
      },
    ] as never;

    const divergence = compareReplay(trace, replayed);
    expect(divergence?.frame).toBe(0);
    expect(divergence?.details.join('\n')).toContain('geometry.shapes');
  });

  test('still compares variables on checkpoint frames', () => {
    const trace = traceOf([
      { digest: 'aaaaaaaa', variables: { zoom: 1.05 }, geometry },
    ]);
    const replayed = [
      { digest: 'bbbbbbbb', variables: { zoom: 1.25 }, geometry },
    ] as never;

    const divergence = compareReplay(trace, replayed);
    expect(divergence?.details.join('\n')).toContain('variables.zoom');
  });

  test('absorbs ULP-scale noise on a checkpoint frame', () => {
    const trace = traceOf([
      {
        digest: 'aaaaaaaa',
        variables: { zoom: 0.07056442000143237 },
        geometry,
      },
    ]);
    const replayed = [
      {
        digest: 'bbbbbbbb',
        variables: { zoom: 0.07056442000143243 }, // 4 ULP, the measured delta
        geometry,
      },
    ] as never;

    expect(compareReplay(trace, replayed)).toBeNull();
  });
});
