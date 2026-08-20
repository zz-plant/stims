import { describe, expect, test } from 'bun:test';
import { createMilkdropSignalTracker } from '../../src/js/milkdrop/runtime-signals.ts';
import {
  createDefaultSignalEnv,
  syncSignalEnvironment,
} from '../../src/js/milkdrop/vm/shared.ts';

const BINS = 512;
const SAMPLE_RATE = 48_000;
const BIN_HZ = SAMPLE_RATE / 2 / BINS;

function toneSpectrum() {
  const data = new Uint8Array(BINS);
  const peak = Math.round(1_000 / BIN_HZ);
  data[peak] = 240;
  data[peak - 1] = 120;
  data[peak + 1] = 120;
  return data;
}

function clickSpectrum() {
  return new Uint8Array(BINS).fill(200);
}

const analyserStub = {
  getSampleRate: () => SAMPLE_RATE,
  getWaveformData: () => new Uint8Array(BINS).fill(128),
  getRmsLevel: () => 0.2,
};

function runTracker(frames: Uint8Array[]) {
  const tracker = createMilkdropSignalTracker();
  let signals = tracker.update({
    time: 0,
    deltaMs: 16.66,
    analyser: analyserStub as never,
    frequencyData: frames[0],
  });
  for (let i = 1; i < frames.length; i += 1) {
    signals = tracker.update({
      time: i / 60,
      deltaMs: 16.66,
      analyser: analyserStub as never,
      frequencyData: frames[i],
    });
  }
  return signals;
}

describe('harmonic/percussive runtime signals', () => {
  test('a sustained tone drives percussive_ratio below the neutral 0.5', () => {
    const signals = runTracker(
      Array.from({ length: 40 }, () => toneSpectrum()),
    );
    expect(signals.percussiveRatio ?? 0).toBeLessThan(0.4);
    expect(signals.percussive_ratio).toBe(signals.percussiveRatio as number);
  });

  test('a click arriving after quiet frames pushes percussive_ratio above 0.5', () => {
    const frames: Uint8Array[] = [];
    for (let i = 0; i < 20; i += 1) frames.push(new Uint8Array(BINS));
    frames.push(clickSpectrum());
    const signals = runTracker(frames);
    expect(signals.percussiveRatio ?? 0).toBeGreaterThan(0.6);
  });

  test('every exposed stem-shaped signal is finite, including in silence', () => {
    const signals = runTracker(
      Array.from({ length: 30 }, () => new Uint8Array(BINS)),
    );
    for (const key of [
      'percussive',
      'harmonic',
      'percussiveLow',
      'percussiveMid',
      'percussiveHigh',
      'percussiveRatio',
      'percussive_low',
      'percussive_mid',
      'percussive_high',
      'percussive_ratio',
    ] as const) {
      expect(Number.isFinite(signals[key])).toBe(true);
    }
  });

  test('the VM signal environment exposes both camelCase and snake_case names', () => {
    const signals = runTracker(
      Array.from({ length: 30 }, () => clickSpectrum()),
    );
    const env = createDefaultSignalEnv();
    syncSignalEnvironment(signals, env);
    expect(env.percussive).toBe(signals.percussive as number);
    expect(env.harmonic).toBe(signals.harmonic as number);
    expect(env.percussive_low).toBe(signals.percussiveLow as number);
    expect(env.percussive_mid).toBe(signals.percussiveMid as number);
    expect(env.percussive_high).toBe(signals.percussiveHigh as number);
    expect(env.percussive_ratio).toBe(signals.percussiveRatio as number);
  });

  test('the default VM environment starts neutral, not at zero', () => {
    const env = createDefaultSignalEnv();
    expect(env.percussive).toBe(1);
    expect(env.harmonic).toBe(1);
    expect(env.percussive_ratio).toBe(0.5);
  });
});
