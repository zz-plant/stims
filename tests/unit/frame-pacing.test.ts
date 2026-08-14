import { describe, expect, test } from 'bun:test';
import {
  createFrameGate,
  FRAME_GATE_TOLERANCE_MS,
} from '../../src/js/core/frame-pacing.ts';

/**
 * Feeds the gate a run of vsyncs at `displayHz` and reports how many were let
 * through — the only number that matters, since a gate that "works" but
 * halves the intended rate is a regression, not a saving.
 */
function countRenderedFrames({
  capHz,
  displayHz,
  frames,
  jitterMs = () => 0,
}: {
  capHz: number | null;
  displayHz: number;
  frames: number;
  jitterMs?: (index: number) => number;
}) {
  const gate = createFrameGate(() => capHz);
  const vsyncMs = 1000 / displayHz;
  let rendered = 0;
  for (let i = 0; i < frames; i += 1) {
    if (gate.shouldRenderFrame(i * vsyncMs + jitterMs(i))) {
      rendered += 1;
    }
  }
  return rendered;
}

describe('createFrameGate', () => {
  test('passes every frame when uncapped', () => {
    expect(
      countRenderedFrames({ capHz: null, displayHz: 60, frames: 120 }),
    ).toBe(120);
    expect(countRenderedFrames({ capHz: 0, displayHz: 60, frames: 120 })).toBe(
      120,
    );
    expect(
      countRenderedFrames({ capHz: Number.NaN, displayHz: 60, frames: 120 }),
    ).toBe(120);
  });

  test('halves a 60Hz display at a 30Hz cap', () => {
    // 120 vsyncs at 60Hz spans ~1.98s, which holds 60 frames at 30Hz.
    expect(countRenderedFrames({ capHz: 30, displayHz: 60, frames: 120 })).toBe(
      60,
    );
  });

  test('quarters a 120Hz display at a 30Hz cap', () => {
    expect(
      countRenderedFrames({ capHz: 30, displayHz: 120, frames: 120 }),
    ).toBe(30);
  });

  test('halves a 120Hz display at the 60Hz conserving cap', () => {
    expect(
      countRenderedFrames({ capHz: 60, displayHz: 120, frames: 120 }),
    ).toBe(60);
  });

  test('never throttles below the cap when frames arrive a hair early', () => {
    // The failure this guards: a tick landing microseconds before the deadline
    // used to be pushed a full vsync later, turning a 30fps cap into 20fps.
    const rendered = countRenderedFrames({
      capHz: 30,
      displayHz: 60,
      frames: 120,
      jitterMs: (i) => (i % 2 === 0 ? -0.4 : 0.4),
    });
    expect(rendered).toBe(60);
  });

  test('does not let a display at the cap rate drop any frames', () => {
    expect(countRenderedFrames({ capHz: 60, displayHz: 60, frames: 120 })).toBe(
      120,
    );
  });

  test('resyncs after a stall instead of bursting the missed frames', () => {
    const gate = createFrameGate(() => 30);
    expect(gate.shouldRenderFrame(0)).toBe(true);
    // A 1s stall (tab wake, long GC) skipped ~30 deadlines.
    expect(gate.shouldRenderFrame(1000)).toBe(true);
    // The next vsync must be gated normally rather than replaying the backlog.
    expect(gate.shouldRenderFrame(1016.67)).toBe(false);
    expect(gate.shouldRenderFrame(1033.34)).toBe(true);
  });

  test('renders immediately when the cap changes mid-session', () => {
    let capHz: number | null = 30;
    const gate = createFrameGate(() => capHz);
    expect(gate.shouldRenderFrame(0)).toBe(true);
    expect(gate.shouldRenderFrame(16.67)).toBe(false);
    capHz = 60;
    // A deadline set at 30Hz must not hold back the first frame at the new rate.
    expect(gate.shouldRenderFrame(20)).toBe(true);
    expect(gate.shouldRenderFrame(28)).toBe(false);
    expect(gate.shouldRenderFrame(36.67)).toBe(true);
  });

  test('reset drops the pending deadline', () => {
    const gate = createFrameGate(() => 30);
    expect(gate.shouldRenderFrame(0)).toBe(true);
    expect(gate.shouldRenderFrame(10)).toBe(false);
    gate.reset();
    expect(gate.shouldRenderFrame(10)).toBe(true);
  });

  test('tolerance stays under half a cap interval at the highest cap used', () => {
    // If the tolerance ever reached half the interval the gate would pass every
    // frame and silently stop capping.
    expect(FRAME_GATE_TOLERANCE_MS).toBeLessThan(1000 / 60 / 2);
  });
});
