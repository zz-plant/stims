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

describe('beat clock with a manual tempo', () => {
  type Manual = { bpm: number; anchorAt: number; source: 'tap' | 'midi-clock' };
  const FRAME_MS = 16;

  /** Frame times in [from, to) on which the clock lands a beat. */
  function beatFrames(
    clock: ReturnType<typeof createMilkdropBeatClock>,
    from: number,
    to: number,
    detectedAt: (frame: number) => boolean = () => false,
  ) {
    const landed: number[] = [];
    for (let at = from; at < to; at += FRAME_MS) {
      if (clock.frameBeat(at, detectedAt(at))) landed.push(at);
    }
    return landed;
  }

  test('reports the manual tempo at full confidence', () => {
    const manual: Manual = { bpm: 120, anchorAt: 1_000, source: 'tap' };
    const clock = createMilkdropBeatClock({ getManualTempo: () => manual });
    const snapshot = clock.snapshot(2_600);
    expect(snapshot.bpm).toBe(120);
    expect(snapshot.confidence).toBe(1);
    expect(snapshot.beatIndex).toBe(3);
    expect(snapshot.barPosition).toBe(3);
    expect(snapshot.lastBeatAt).toBe(2_500);
  });

  test('lands a beat on the first frame past each grid beat and ignores onsets', () => {
    const manual: Manual = { bpm: 120, anchorAt: 1_000, source: 'tap' };
    const clock = createMilkdropBeatClock({ getManualTempo: () => manual });
    // Onsets on every frame: a detector that fires constantly must not add
    // a single beat to the tapped grid.
    const landed = beatFrames(clock, 1_008, 3_100, () => true);
    expect(landed).toEqual([1_504, 2_000, 2_512, 3_008]);
  });

  test('every fourth grid beat opens a bar', () => {
    const manual: Manual = { bpm: 120, anchorAt: 1_000, source: 'tap' };
    const clock = createMilkdropBeatClock({ getManualTempo: () => manual });
    const downbeats = beatFrames(clock, 1_008, 5_100).filter((at) =>
      clock.isDownbeat(at),
    );
    // Frames fall every 16 ms from 1 008, so each bar line (3 000, 5 000)
    // lands on the first frame after it.
    expect(downbeats).toEqual([3_008, 5_008]);
  });

  test('moving the grid backwards fires no extra beat', () => {
    const manual: Manual = { bpm: 120, anchorAt: 1_000, source: 'tap' };
    const clock = createMilkdropBeatClock({ getManualTempo: () => manual });
    beatFrames(clock, 1_008, 2_200);
    // A re-sync tap at 2 200: the beat the grid now says is 0 must not
    // fire on this frame, and the next one lands half a second later.
    manual.anchorAt = 2_200;
    expect(beatFrames(clock, 2_200, 2_800)).toEqual([2_712]);
  });

  test('onsets keep the estimate warm underneath, so clearing hands one back', () => {
    let manual: Manual | null = { bpm: 90, anchorAt: 0, source: 'tap' };
    const clock = createMilkdropBeatClock({ getManualTempo: () => manual });
    const last = playSteadyBeats(clock, { periodMs: 500, count: 8 });
    expect(clock.snapshot(last).bpm).toBe(90);
    manual = null;
    expect(clock.snapshot(last).bpm).toBeCloseTo(120, 5);
  });

  test('auto-advance switches on the tapped downbeat, not the detected one', () => {
    // The music's onsets sit a quarter-beat off the tapped grid. Left to the
    // audio, the confident estimate would put the switch on an onset.
    const manual: Manual = { bpm: 120, anchorAt: 1_000, source: 'tap' };
    const clock = createMilkdropBeatClock({ getManualTempo: () => manual });
    const gate = createAutoAdvanceGate();
    const onset = (at: number) => (at - 1_125) % 500 < FRAME_MS && at >= 1_125;
    let fired: number | null = null;
    for (let at = 1_008; at < 4_000 && fired === null; at += FRAME_MS) {
      const detected = onset(at);
      if (detected) clock.noteBeat(at);
      const beat = clock.frameBeat(at, detected);
      const due = at >= 1_800;
      if (
        gate.update({
          due,
          now: at,
          beat,
          downbeat: clock.isDownbeat(at),
          tempoConfident: clock.snapshot(at).confidence >= 0.6,
        })
      ) {
        fired = at;
      }
    }
    // Armed at 1 800; the next tapped bar line is 3 000, first framed at
    // 3 008. The onset at 3 125 is the one the audio would have chosen.
    expect(fired).toBe(3_008);
  });
});
