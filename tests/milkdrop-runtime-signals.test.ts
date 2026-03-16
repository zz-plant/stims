import { describe, expect, test } from 'bun:test';
import { createMilkdropSignalTracker } from '../assets/js/milkdrop/runtime-signals.ts';
import type { FrequencyAnalyser } from '../assets/js/utils/audio-handler.ts';

function highEnergyData() {
  const data = new Uint8Array(128);
  data.fill(255);
  return data;
}

describe('milkdrop runtime signals', () => {
  test('increments frame count and emits stable ranges with fallback data', () => {
    const tracker = createMilkdropSignalTracker();

    const first = tracker.update({
      time: 0,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: highEnergyData(),
    });
    const second = tracker.update({
      time: 0.3,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: highEnergyData(),
    });

    expect(first.frame).toBe(1);
    expect(second.frame).toBe(2);
    expect(first.bass).toBeGreaterThan(0);
    expect(first.weightedEnergy).toBeLessThanOrEqual(1);
    expect(second.beat).toBe(1);
    expect(second.beatPulse).toBeGreaterThan(0);
  });

  test('uses analyser-provided bands and smoothed RMS when available', () => {
    const tracker = createMilkdropSignalTracker();
    const analyserStub = {
      getMultiBandEnergy: () => ({ bass: 0.75, mid: 0.4, treble: 0.25 }),
      getRmsLevel: () => 0.8,
    } as unknown as FrequencyAnalyser;

    const update = tracker.update({
      time: 0.4,
      deltaMs: 16.7,
      analyser: analyserStub,
      frequencyData: new Uint8Array(64),
    });

    expect(update.bass).toBeCloseTo(0.75, 6);
    expect(update.mids).toBeCloseTo(0.4, 6);
    expect(update.treble).toBeCloseTo(0.25, 6);
    expect(update.rms).toBeGreaterThan(0.1);
    expect(update.rms).toBeLessThan(0.2);
  });

  test('reset restarts frame numbering and tracker state', () => {
    const tracker = createMilkdropSignalTracker();
    tracker.update({
      time: 0.1,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: highEnergyData(),
    });
    tracker.update({
      time: 0.35,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: highEnergyData(),
    });

    tracker.reset();

    const afterReset = tracker.update({
      time: 0.5,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: highEnergyData(),
    });
    expect(afterReset.frame).toBe(1);
    expect(afterReset.bassAtt).toBeGreaterThanOrEqual(0);
  });
});
