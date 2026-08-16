import { describe, expect, test } from 'bun:test';
import { createMilkdropSignalTracker } from '../../src/js/milkdrop/runtime-signals.ts';

const BINS = 512;
const SAMPLE_RATE = 48_000;

const analyserStub = {
  getSampleRate: () => SAMPLE_RATE,
  getWaveformData: () => new Uint8Array(BINS).fill(128),
  getRmsLevel: () => 0.2,
};

function spectrum(level: number) {
  return new Uint8Array(BINS).fill(Math.round(level * 255));
}

describe('relationship lock (preset-facing clock pinning)', () => {
  test('pins time and frame at the first locked frame while audio still flows', () => {
    const tracker = createMilkdropSignalTracker();
    // Warmup, unlocked.
    for (let i = 0; i < 5; i += 1) {
      tracker.update({
        time: i / 60,
        deltaMs: 16.66,
        analyser: analyserStub as never,
        frequencyData: spectrum(0.1),
      });
    }
    const lockOnset = 5 / 60;

    const locked: number[] = [];
    const bass: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const signals = tracker.update({
        time: (5 + i) / 60,
        deltaMs: 16.66,
        analyser: analyserStub as never,
        frequencyData: spectrum(0.1 + 0.05 * i),
        relationshipLock: true,
      });
      locked.push(signals.time);
      bass.push(signals.bass_att);
    }

    // Time is pinned at the onset value, not advancing with wall frames.
    expect(locked.every((t) => t === lockOnset)).toBe(true);
    // RelationshipLock flag surfaces so the VM can bypass its env cache.
    const last = tracker.update({
      time: 1,
      deltaMs: 16.66,
      analyser: analyserStub as never,
      frequencyData: spectrum(0.5),
      relationshipLock: true,
    });
    expect(last.relationshipLock).toBe(true);
  });

  test('audio signals keep changing under the lock', () => {
    const tracker = createMilkdropSignalTracker();
    const levels: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const signals = tracker.update({
        time: i / 60,
        deltaMs: 16.66,
        analyser: analyserStub as never,
        frequencyData: spectrum(0.1 + 0.08 * i),
        relationshipLock: true,
      });
      levels.push(signals.rms);
    }
    // The audio-derived signals are not frozen just because the clock is.
    const distinct = new Set(levels.map((v) => v.toFixed(4))).size;
    expect(distinct).toBeGreaterThan(3);
  });

  test('unlocking releases the pin and time advances again', () => {
    const tracker = createMilkdropSignalTracker();
    let locked: number | undefined;
    for (let i = 0; i < 3; i += 1) {
      const s = tracker.update({
        time: i / 60,
        deltaMs: 16.66,
        analyser: analyserStub as never,
        frequencyData: spectrum(0.2),
        relationshipLock: true,
      });
      locked = s.time;
    }
    const unlocked = tracker.update({
      time: 99 / 60,
      deltaMs: 16.66,
      analyser: analyserStub as never,
      frequencyData: spectrum(0.2),
      relationshipLock: false,
    });
    expect(unlocked.time).toBe(99 / 60);
    expect(unlocked.time).not.toBe(locked);
    expect(unlocked.relationshipLock).toBe(false);
  });

  test('a re-engaged lock re-pins at the new onset, not the old one', () => {
    const tracker = createMilkdropSignalTracker();
    tracker.update({
      time: 0,
      deltaMs: 16.66,
      analyser: analyserStub as never,
      frequencyData: spectrum(0.2),
      relationshipLock: true,
    });
    tracker.update({
      time: 1,
      deltaMs: 16.66,
      analyser: analyserStub as never,
      frequencyData: spectrum(0.2),
      relationshipLock: false,
    });
    const reLocked = tracker.update({
      time: 2,
      deltaMs: 16.66,
      analyser: analyserStub as never,
      frequencyData: spectrum(0.2),
      relationshipLock: true,
    });
    expect(reLocked.time).toBe(2);
  });
});
