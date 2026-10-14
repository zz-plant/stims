import { afterEach, describe, expect, test } from 'bun:test';
import {
  clearManualTempo,
  followMidiClock,
  getManualTempo,
  getManualTempoSource,
  MIDI_CLOCK_STALE_MS,
  nudgeManualTempo,
  resetManualTempo,
  subscribeManualTempo,
  TAP_SERIES_GAP_MS,
  tapTempo,
} from '../../src/js/core/manual-tempo.ts';

afterEach(() => resetManualTempo());

/** Taps `count` beats `periodMs` apart from `from`; returns the last time. */
function tapSteady({ from = 1_000, periodMs = 500, count = 4 } = {}) {
  let at = from;
  for (let i = 0; i < count; i += 1) {
    tapTempo(at);
    at += periodMs;
  }
  return at - periodMs;
}

describe('tap tempo', () => {
  test('one tap is not a tempo; the second sets it', () => {
    expect(tapTempo(1_000)).toEqual({ kind: 'counting' });
    expect(getManualTempo(1_000)).toBeNull();

    const second = tapTempo(1_500);
    expect(second.kind).toBe('tempo');
    expect(getManualTempo(1_500)?.bpm).toBeCloseTo(120, 5);
  });

  test('the first tap of the series is the downbeat', () => {
    tapSteady({ from: 1_000, periodMs: 500, count: 4 });
    const tempo = getManualTempo(2_500);
    expect(tempo?.source).toBe('tap');
    expect(tempo?.anchorAt).toBeCloseTo(1_000, 5);
  });

  test('uneven taps are fitted, not anchored on the first one', () => {
    // A performer 30 ms late on the first tap and on time after it.
    // Anchoring on that tap would put every bar line 30 ms late; the fit
    // spreads the error across the series.
    for (const at of [1_030, 1_500, 2_000, 2_500, 3_000]) tapTempo(at);
    const tempo = getManualTempo(3_000);
    expect(Math.abs((tempo?.bpm ?? 0) - 120)).toBeLessThan(2);
    expect(Math.abs((tempo?.anchorAt ?? 0) - 1_000)).toBeLessThan(20);
  });

  test('a key repeat or a bounced pad is not a beat', () => {
    tapTempo(1_000);
    tapTempo(1_500);
    expect(tapTempo(1_530)).toEqual({ kind: 'ignored' });
    expect(getManualTempo(1_530)?.bpm).toBeCloseTo(120, 5);
  });

  test('a missed tap counts as the beat it skipped', () => {
    tapSteady({ from: 1_000, periodMs: 500, count: 3 });
    // Beat four was missed; the next tap lands on beat five.
    tapTempo(3_000);
    expect(getManualTempo(3_000)?.bpm).toBeCloseTo(120, 5);
  });

  test('after a pause, one tap moves the downbeat and keeps the tempo', () => {
    tapSteady({ from: 1_000, periodMs: 500, count: 4 });
    const resyncAt = 2_500 + TAP_SERIES_GAP_MS + 1_234;
    const result = tapTempo(resyncAt);
    expect(result.kind).toBe('resync');
    const tempo = getManualTempo(resyncAt);
    expect(tempo?.anchorAt).toBe(resyncAt);
    expect(tempo?.bpm).toBeCloseTo(120, 5);
  });

  test('a long series keeps the bar line it started with', () => {
    // Twelve taps drop the oldest four from the fit. The downbeat must stay
    // on the first tap's grid, not slide to whichever tap is now oldest.
    tapSteady({ from: 1_000, periodMs: 500, count: 12 });
    const tempo = getManualTempo(6_500);
    expect(tempo?.anchorAt).toBeCloseTo(1_000, 5);
  });

  test('nudging moves the grid without changing the tempo', () => {
    tapSteady();
    nudgeManualTempo(20);
    const tempo = getManualTempo(2_500);
    expect(tempo?.anchorAt).toBeCloseTo(1_020, 5);
    expect(tempo?.bpm).toBeCloseTo(120, 5);
  });

  test('clearing hands the tempo back and reports whether one was set', () => {
    tapSteady();
    expect(clearManualTempo()).toBe(true);
    expect(getManualTempo(2_500)).toBeNull();
    expect(clearManualTempo()).toBe(false);
    // The series is gone too: the next tap starts counting afresh.
    expect(tapTempo(2_700)).toEqual({ kind: 'counting' });
  });
});

describe('MIDI clock', () => {
  const running = { bpm: 128, running: true, barPosition: 0.25 };

  test('a running clock sets the tempo and puts the bar where it says', () => {
    expect(followMidiClock(running, 10_000)).toBe('started');
    const tempo = getManualTempo(10_000);
    expect(tempo?.source).toBe('midi-clock');
    expect(tempo?.bpm).toBe(128);
    // A quarter of the way through a 4/4 bar is one beat after the downbeat.
    expect(tempo?.anchorAt).toBeCloseTo(10_000 - 60_000 / 128, 5);
    expect(followMidiClock(running, 10_020)).toBe('unchanged');
  });

  test('refuses taps while it runs', () => {
    followMidiClock(running, 10_000);
    expect(tapTempo(10_100)).toEqual({ kind: 'clock-locked', bpm: 128 });
    expect(nudgeManualTempo(20)?.anchorAt).toBe(
      getManualTempo(10_100)?.anchorAt,
    );
  });

  test('a Stop hands the tempo back to the music', () => {
    followMidiClock(running, 10_000);
    expect(followMidiClock({ ...running, running: false }, 10_100)).toBe(
      'stopped',
    );
    expect(getManualTempo(10_100)).toBeNull();
  });

  test('a clock that goes silent without a Stop is dropped', () => {
    followMidiClock(running, 10_000);
    expect(getManualTempo(10_000 + MIDI_CLOCK_STALE_MS)).not.toBeNull();
    expect(getManualTempo(10_000 + MIDI_CLOCK_STALE_MS + 1)).toBeNull();
    expect(tapTempo(12_000)).toEqual({ kind: 'counting' });
  });
});

describe('listeners', () => {
  test('hear a change a person would notice, not every clock tick', () => {
    let calls = 0;
    subscribeManualTempo(() => {
      calls += 1;
    });
    followMidiClock({ bpm: 128, running: true, barPosition: 0 }, 10_000);
    expect(calls).toBe(1);
    expect(getManualTempoSource()).toBe('midi-clock');
    // Tick jitter: a few hundredths of a BPM, a couple of ms of phase.
    for (let tick = 1; tick <= 24; tick += 1) {
      followMidiClock(
        {
          bpm: 128 + (tick % 2 ? 0.03 : -0.03),
          running: true,
          barPosition: tick / 96,
        },
        10_000 + tick * (60_000 / 128 / 24) + (tick % 3),
      );
    }
    expect(calls).toBe(1);
    followMidiClock({ bpm: 128, running: false, barPosition: 0 }, 11_000);
    expect(calls).toBe(2);
    expect(getManualTempoSource()).toBeNull();
  });
});
