/**
 * The runtime flash governor, judged by the offline WCAG analyser.
 *
 * The claim this suite has to earn is specific: a sequence that FAILS
 * WCAG 2.3.1 when presented raw must PASS once the governor's hold is
 * applied. So the governed frames are scored by `analyzeFlashTimeline` —
 * the same instrument `bun run lab:flash-audit` uses — rather than by
 * re-asserting the governor's own bookkeeping, which would only prove it
 * agrees with itself.
 *
 * The false-positive direction matters just as much: content that is merely
 * bright, fast, or high-contrast-but-monotonic must never be held back, or
 * the governor becomes a blur filter nobody wants.
 */
import { describe, expect, test } from 'bun:test';
import { analyzeFlashTimeline } from '../../scripts/flash-analysis.ts';
import {
  createFlashGovernor,
  MIN_USEFUL_GRID,
  RECOMMENDED_GRID,
} from '../../src/js/core/services/flash-governor.ts';

const COLS = 6;
const ROWS = 6;
const TILES = COLS * ROWS;
const FRAME_MS = 1000 / 60;

function uniformFrame(luminance: number): number[] {
  return new Array(TILES).fill(luminance);
}

/** Full-field strobe: flips between `low` and `high` every `holdFrames`. */
function strobeTimeline(
  frameCount: number,
  holdFrames: number,
  low = 0.02,
  high = 0.95,
): number[][] {
  const frames: number[][] = [];
  for (let i = 0; i < frameCount; i += 1) {
    const on = Math.floor(i / holdFrames) % 2 === 1;
    frames.push(uniformFrame(on ? high : low));
  }
  return frames;
}

/**
 * Runs a timeline through the governor and returns what a viewer would
 * actually see: each frame blended over the previous PRESENTED frame by the
 * hold the governor asked for. This is the renderer's side of the contract.
 */
function present(
  source: number[][],
  governor: ReturnType<typeof createFlashGovernor>,
): number[][] {
  const presented: number[][] = [];
  let last: number[] | null = null;
  for (const [index, frame] of source.entries()) {
    const now = index * FRAME_MS;
    // The governor observes what is on screen, not the raw source — the
    // held frame is what the viewer's eye integrates, and feeding it the
    // source instead would make the hold invisible to its own accounting.
    const observed = last ?? frame;
    const { hold } = governor.sample(now, observed, COLS, ROWS);
    const previousFrame = last;
    const blended: number[] = previousFrame
      ? frame.map(
          (v, i) => (previousFrame[i] as number) * hold + v * (1 - hold),
        )
      : [...frame];
    presented.push(blended);
    last = blended;
  }
  return presented;
}

describe('flash governor', () => {
  test('a 10Hz full-field strobe fails WCAG when presented raw', () => {
    const raw = strobeTimeline(180, 3);
    const analysis = analyzeFlashTimeline({
      frames: raw,
      deltaMs: FRAME_MS,
      cols: COLS,
      rows: ROWS,
    });
    expect(analysis.peakFlashesPerSecond).toBeGreaterThan(3);
    expect(analysis.exceedsThreshold).toBe(true);
  });

  test('the same strobe passes WCAG once the governor holds frames', () => {
    const raw = strobeTimeline(180, 3);
    const governed = present(raw, createFlashGovernor());
    const analysis = analyzeFlashTimeline({
      frames: governed,
      deltaMs: FRAME_MS,
      cols: COLS,
      rows: ROWS,
    });
    expect(analysis.peakFlashesPerSecond).toBeLessThanOrEqual(3);
    expect(analysis.exceedsThreshold).toBe(false);
  });

  test('a faster 20Hz strobe is also brought under the threshold', () => {
    const raw = strobeTimeline(180, 1);
    const rawAnalysis = analyzeFlashTimeline({
      frames: raw,
      deltaMs: FRAME_MS,
      cols: COLS,
      rows: ROWS,
    });
    expect(rawAnalysis.exceedsThreshold).toBe(true);

    const governed = present(raw, createFlashGovernor());
    const analysis = analyzeFlashTimeline({
      frames: governed,
      deltaMs: FRAME_MS,
      cols: COLS,
      rows: ROWS,
    });
    expect(analysis.exceedsThreshold).toBe(false);
  });

  test('the luminance-scale mitigation also brings the strobe under threshold', () => {
    // The scrim path: instead of blending against the previous frame, scale
    // the whole frame by luminanceScale. Different picture, same arithmetic
    // — and this is the form that works on both renderer backends.
    const raw = strobeTimeline(180, 3);
    const governor = createFlashGovernor();
    const scaled: number[][] = [];
    let last: number[] | null = null;
    for (const [index, frame] of raw.entries()) {
      const observed = last ?? frame;
      const { luminanceScale } = governor.sample(
        index * FRAME_MS,
        observed,
        COLS,
        ROWS,
      );
      const presented = frame.map((v) => v * luminanceScale);
      scaled.push(presented);
      last = presented;
    }
    const analysis = analyzeFlashTimeline({
      frames: scaled,
      deltaMs: FRAME_MS,
      cols: COLS,
      rows: ROWS,
    });
    expect(analysis.exceedsThreshold).toBe(false);
  });

  test('luminanceScale is the complement of hold', () => {
    const governor = createFlashGovernor();
    for (const [index, frame] of strobeTimeline(120, 3).entries()) {
      const decision = governor.sample(index * FRAME_MS, frame, COLS, ROWS);
      expect(decision.luminanceScale).toBeCloseTo(1 - decision.hold, 10);
    }
  });

  test('a monotonic fade is never held back', () => {
    const governor = createFlashGovernor();
    let maxHold = 0;
    for (let i = 0; i < 120; i += 1) {
      const { hold } = governor.sample(
        i * FRAME_MS,
        uniformFrame(i / 119),
        COLS,
        ROWS,
      );
      maxHold = Math.max(maxHold, hold);
    }
    // A fade to white crosses every luminance threshold there is, but never
    // reverses, so it is not a flash and must not be treated as one.
    expect(maxHold).toBe(0);
  });

  test('a steady bright image is never held back', () => {
    const governor = createFlashGovernor();
    let maxHold = 0;
    for (let i = 0; i < 120; i += 1) {
      const { hold } = governor.sample(
        i * FRAME_MS,
        uniformFrame(0.9),
        COLS,
        ROWS,
      );
      maxHold = Math.max(maxHold, hold);
    }
    expect(maxHold).toBe(0);
  });

  test('a small flashing region does not trip the governor at the recommended grid', () => {
    // At RECOMMENDED_GRID the field window is 5x5 tiles, so one strobing
    // tile is 4% of it — a sparkle, not a quarter of the visual field.
    const grid = RECOMMENDED_GRID;
    const governor = createFlashGovernor();
    let maxHold = 0;
    for (let i = 0; i < 120; i += 1) {
      const frame = new Array(grid * grid).fill(0.1);
      frame[0] = i % 2 === 0 ? 0.02 : 0.95;
      maxHold = Math.max(
        maxHold,
        governor.sample(i * FRAME_MS, frame, grid, grid).hold,
      );
    }
    expect(maxHold).toBe(0);
  });

  test('too coarse a grid cannot discriminate a single tile — hence MIN_USEFUL_GRID', () => {
    // Documents WHY the constant exists rather than asserting a magic
    // number: below it, the field window shrinks until one tile alone meets
    // the 25% area rule and every isolated flicker reads as a full flash.
    const coarse = 6;
    expect(coarse).toBeLessThan(MIN_USEFUL_GRID);
    const governor = createFlashGovernor();
    let tripped = false;
    for (let i = 0; i < 60; i += 1) {
      const frame = new Array(coarse * coarse).fill(0.1);
      frame[0] = i % 2 === 0 ? 0.02 : 0.95;
      if (governor.sample(i * FRAME_MS, frame, coarse, coarse).hold > 0) {
        tripped = true;
      }
    }
    expect(tripped).toBe(true);

    // The same content at the recommended grid does not trip it.
    const fine = createFlashGovernor();
    let fineTripped = false;
    for (let i = 0; i < 60; i += 1) {
      const frame = new Array(RECOMMENDED_GRID * RECOMMENDED_GRID).fill(0.1);
      frame[0] = i % 2 === 0 ? 0.02 : 0.95;
      if (
        fine.sample(i * FRAME_MS, frame, RECOMMENDED_GRID, RECOMMENDED_GRID)
          .hold > 0
      ) {
        fineTripped = true;
      }
    }
    expect(fineTripped).toBe(false);
  });

  test('the governor releases after the strobe stops', () => {
    const governor = createFlashGovernor();
    const strobe = strobeTimeline(120, 3);
    for (const [index, frame] of strobe.entries()) {
      governor.sample(index * FRAME_MS, frame, COLS, ROWS);
    }
    expect(governor.getState().hold).toBeGreaterThan(0);

    // Release is deliberately measured in seconds, not frames: a fast
    // release lets the strobe restart and re-trigger, which is a limit cycle
    // the governor itself drives. Give it long enough to actually finish.
    for (let i = 0; i < 700; i += 1) {
      governor.sample((120 + i) * FRAME_MS, uniformFrame(0.4), COLS, ROWS);
    }
    expect(governor.getState().hold).toBe(0);
    expect(governor.getState().flashesInWindow).toBe(0);
  });

  test('release does not begin during the hold-off', () => {
    // The window empties as soon as the clamp works, so releasing on an
    // empty window alone would immediately undo the clamp.
    const governor = createFlashGovernor();
    for (const [index, frame] of strobeTimeline(120, 3).entries()) {
      governor.sample(index * FRAME_MS, frame, COLS, ROWS);
    }
    const engaged = governor.getState().hold;
    expect(engaged).toBeGreaterThan(0);

    // Half a second of calm — inside the hold-off.
    for (let i = 0; i < 30; i += 1) {
      governor.sample((120 + i) * FRAME_MS, uniformFrame(0.4), COLS, ROWS);
    }
    expect(governor.getState().hold).toBe(engaged);
  });

  test('the response is proportional to how severe the flashing is', () => {
    // A blind ramp punished a mild flicker as hard as a full-range strobe.
    // The solved step should leave gentle content much less clamped.
    const settle = (low: number, high: number) => {
      const governor = createFlashGovernor();
      let scale = 1;
      for (let i = 0; i < 600; i += 1) {
        const raw = Math.floor(i / 3) % 2 === 1 ? high : low;
        const observed = uniformFrame(raw * scale);
        scale = governor.sample(
          i * FRAME_MS,
          observed,
          COLS,
          ROWS,
        ).luminanceScale;
      }
      return scale;
    };
    const mild = settle(0.3, 0.45);
    const extreme = settle(0.0, 1.0);
    expect(mild).toBeGreaterThan(extreme);
    expect(mild).toBeGreaterThan(0.4);
    expect(extreme).toBeLessThan(0.2);
  });

  test('reset clears the window and the hold', () => {
    const governor = createFlashGovernor();
    for (const [index, frame] of strobeTimeline(120, 3).entries()) {
      governor.sample(index * FRAME_MS, frame, COLS, ROWS);
    }
    expect(governor.getState().hold).toBeGreaterThan(0);
    governor.reset();
    expect(governor.getState().hold).toBe(0);
    expect(governor.getState().flashesInWindow).toBe(0);
  });
});
