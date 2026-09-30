/**
 * A deterministic capture resets the signal tracker between pumps (see the
 * resetHistory branch of experience-frame-loop.ts). That only makes pumps
 * repeat if reset() clears every piece of history: attenuated bands,
 * running averages, the beat tracker. Otherwise the same synthetic audio
 * yields different bass/treb and beats on every pump after the first,
 * which is what made lab:flash-audit measure one preset at 0, 48 and 0
 * flashes per second on three identical captures.
 */
import { describe, expect, test } from 'bun:test';
import { createMilkdropSignalTracker } from '../../src/js/milkdrop/runtime-signals.ts';

function feed(
  tracker: ReturnType<typeof createMilkdropSignalTracker>,
  frames: number,
  level: (frame: number) => number,
) {
  const frequencyData = new Uint8Array(128);
  const waveformData = new Uint8Array(128).fill(128);
  const out: Array<Record<string, number>> = [];
  for (let frame = 0; frame < frames; frame += 1) {
    frequencyData.fill(level(frame));
    const signals = tracker.update({
      time: frame / 60,
      deltaMs: 1000 / 60,
      analyser: null,
      frequencyData,
      waveformData,
    });
    out.push({
      bass: signals.bass,
      bass_att: signals.bass_att,
      treb_att: signals.treb_att,
      vol: signals.vol,
      beat: signals.beat,
      beat_pulse: signals.beat_pulse,
      rms: signals.rms,
    });
  }
  return out;
}

// A kick every half second over a quiet floor.
const kicks = (frame: number) => (frame % 30 < 4 ? 230 : 40);

describe('signal tracker reset', () => {
  test('after reset, the same audio gives the same signals as a fresh tracker', () => {
    const fresh = feed(createMilkdropSignalTracker(), 120, kicks);
    const reused = createMilkdropSignalTracker();
    // Different history first: loud, then silence.
    feed(reused, 90, (frame) => (frame < 45 ? 250 : 0));
    reused.reset();
    expect(feed(reused, 120, kicks)).toEqual(fresh);
  });

  test('without a reset the history shows (the test can fail)', () => {
    const fresh = feed(createMilkdropSignalTracker(), 120, kicks);
    const reused = createMilkdropSignalTracker();
    feed(reused, 90, (frame) => (frame < 45 ? 250 : 0));
    expect(feed(reused, 120, kicks)).not.toEqual(fresh);
  });
});
