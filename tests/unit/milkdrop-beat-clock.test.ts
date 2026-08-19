import { describe, expect, test } from 'bun:test';
import { createMilkdropBeatClock } from '../../src/js/milkdrop/runtime/beat-clock.ts';
import {
  AUTO_ADVANCE_BEAT_TIMEOUT_MS,
  AUTO_ADVANCE_BEAT_WINDOW_MS,
  createAutoAdvanceGate,
} from '../../src/js/milkdrop/runtime/lifecycle.ts';

/** Feeds `count` beats at a fixed period, starting at `from`. */
function playSteadyBeats(
  clock: ReturnType<typeof createMilkdropBeatClock>,
  { from = 0, periodMs = 500, count = 8 } = {},
) {
  let at = from;
  for (let i = 0; i < count; i += 1) {
    clock.noteBeat(at);
    at += periodMs;
  }
  return at - periodMs;
}

describe('milkdrop beat clock', () => {
  test('estimates tempo from steady beats', () => {
    const clock = createMilkdropBeatClock();
    const last = playSteadyBeats(clock, { periodMs: 500, count: 8 });

    const snapshot = clock.snapshot(last);
    expect(snapshot.bpm).toBeCloseTo(120, 5);
    expect(snapshot.confidence).toBe(1);
    expect(snapshot.beatIndex).toBe(8);
  });

  test('reports no tempo until a quorum of intervals exists', () => {
    const clock = createMilkdropBeatClock();
    // Two intervals is not evidence, however well they agree.
    playSteadyBeats(clock, { periodMs: 500, count: 3 });

    expect(clock.snapshot(1_000).bpm).toBeNull();
    expect(clock.snapshot(1_000).confidence).toBe(0);
  });

  test('ignores implausible intervals as tempo evidence but still counts the beat', () => {
    const clock = createMilkdropBeatClock();
    playSteadyBeats(clock, { periodMs: 500, count: 6 });
    // A double-trigger 40ms after the last kick: too fast to be a beat of
    // its own, and averaging it in would halve the estimated period.
    clock.noteBeat(2_540);

    const snapshot = clock.snapshot(2_540);
    expect(snapshot.bpm).toBeCloseTo(120, 5);
    expect(snapshot.beatIndex).toBe(7);
  });

  test('drops confidence when intervals disagree', () => {
    const clock = createMilkdropBeatClock();
    let at = 0;
    for (const interval of [500, 900, 400, 1200, 350, 800]) {
      clock.noteBeat(at);
      at += interval;
    }

    expect(clock.snapshot(at).confidence).toBeLessThan(0.6);
  });

  test('marks every fourth beat as a downbeat', () => {
    const clock = createMilkdropBeatClock();
    const positions: number[] = [];
    let at = 0;
    for (let i = 0; i < 8; i += 1) {
      clock.noteBeat(at);
      positions.push(clock.snapshot(at).barPosition);
      at += 500;
    }

    // First beat opens the bar; the pattern repeats every four.
    expect(positions).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
  });

  test('restarts the estimate and the bar after a long silence', () => {
    const clock = createMilkdropBeatClock();
    playSteadyBeats(clock, { periodMs: 500, count: 8 });

    // Track ends; the next track starts 30s later at a different tempo.
    clock.noteBeat(34_000);
    expect(clock.snapshot(34_000).bpm).toBeNull();
    expect(clock.snapshot(34_000).barPosition).toBe(0);

    let at = 34_000;
    for (let i = 0; i < 6; i += 1) {
      at += 750;
      clock.noteBeat(at);
    }
    expect(clock.snapshot(at).bpm).toBeCloseTo(80, 5);
  });

  test('reports a stale tempo as unusable rather than as fact', () => {
    const clock = createMilkdropBeatClock();
    const last = playSteadyBeats(clock, { periodMs: 500, count: 8 });

    // Audio stopped; the last estimate must not keep presenting itself as
    // current, or a quantized switch would wait for beats that never come.
    const snapshot = clock.snapshot(last + 10_000);
    expect(snapshot.bpm).toBeNull();
    expect(snapshot.confidence).toBe(0);
  });
});

describe('auto-advance gate', () => {
  const idle = {
    due: false,
    beat: false,
    downbeat: false,
    tempoConfident: true,
  };

  test('does not fire while the dwell predicate is unmet', () => {
    const gate = createAutoAdvanceGate();
    expect(gate.update({ ...idle, now: 1_000, beat: true })).toBe(false);
    expect(gate.isArmed()).toBe(false);
  });

  test('holds an armed switch until a downbeat', () => {
    const gate = createAutoAdvanceGate();
    const armed = { due: true, tempoConfident: true };

    expect(
      gate.update({ ...armed, now: 0, beat: false, downbeat: false }),
    ).toBe(false);
    expect(gate.isArmed()).toBe(true);
    // An off-bar beat is not good enough while the tempo is trustworthy.
    expect(
      gate.update({ ...armed, now: 500, beat: true, downbeat: false }),
    ).toBe(false);
    expect(
      gate.update({ ...armed, now: 1_000, beat: true, downbeat: true }),
    ).toBe(true);
    expect(gate.isArmed()).toBe(false);
  });

  test('settles for any beat once the downbeat window has passed', () => {
    const gate = createAutoAdvanceGate();
    const armed = { due: true, tempoConfident: true, downbeat: false };

    gate.update({ ...armed, now: 0, beat: false });
    expect(
      gate.update({
        ...armed,
        now: AUTO_ADVANCE_BEAT_WINDOW_MS - 1,
        beat: true,
      }),
    ).toBe(false);
    expect(
      gate.update({
        ...armed,
        now: AUTO_ADVANCE_BEAT_WINDOW_MS + 1,
        beat: true,
      }),
    ).toBe(true);
  });

  test('takes the next beat when there is no trustworthy tempo', () => {
    const gate = createAutoAdvanceGate();
    const armed = { due: true, tempoConfident: false, downbeat: false };

    gate.update({ ...armed, now: 0, beat: false });
    // No confident tempo means no bar to wait for, so waiting would only
    // add latency to a moment that is already the best one available.
    expect(gate.update({ ...armed, now: 300, beat: true })).toBe(true);
  });

  test('fires without a beat once the hard timeout elapses', () => {
    const gate = createAutoAdvanceGate();
    const armed = {
      due: true,
      beat: false,
      downbeat: false,
      tempoConfident: true,
    };

    gate.update({ ...armed, now: 0 });
    expect(
      gate.update({ ...armed, now: AUTO_ADVANCE_BEAT_TIMEOUT_MS - 1 }),
    ).toBe(false);
    // Ambient material and a failed detector both land here: the switch
    // still happens, it just stops pretending there was a beat to hit.
    expect(gate.update({ ...armed, now: AUTO_ADVANCE_BEAT_TIMEOUT_MS })).toBe(
      true,
    );
  });

  test('disarms when the switch happens for another reason', () => {
    const gate = createAutoAdvanceGate();
    const armed = {
      due: true,
      beat: false,
      downbeat: false,
      tempoConfident: true,
    };

    gate.update({ ...armed, now: 0 });
    expect(gate.isArmed()).toBe(true);
    // A manual next moves lastPresetSwitchAt, so the dwell predicate goes
    // false and the pending wait must not survive into the new preset.
    gate.update({ ...armed, due: false, now: 100 });
    expect(gate.isArmed()).toBe(false);
  });
});
