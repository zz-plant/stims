import { describe, expect, test } from 'bun:test';
import type { FrequencyAnalyser } from '../assets/js/core/audio-handler.ts';
import { createMilkdropSignalTracker } from '../assets/js/milkdrop/runtime-signals.ts';

function highEnergyData() {
  const data = new Uint8Array(128);
  data.fill(255);
  return data;
}

function waveformData() {
  const data = new Uint8Array(128);
  for (let index = 0; index < data.length; index += 1) {
    const ratio = index / Math.max(1, data.length - 1);
    data[index] = Math.round(128 + Math.sin(ratio * Math.PI * 4) * 72);
  }
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
      waveformData: waveformData(),
    });
    const second = tracker.update({
      time: 0.3,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: highEnergyData(),
      waveformData: waveformData(),
    });

    expect(first.frame).toBe(1);
    expect(second.frame).toBe(2);
    expect(first.bass).toBeGreaterThan(0);
    expect(first.weightedEnergy).toBeLessThanOrEqual(1);
    expect(second.beat).toBe(1);
    expect(second.beatPulse).toBeGreaterThan(0);
    expect(second.beat_pulse).toBe(second.beatPulse);
    expect(second.vol).toBeCloseTo(second.rms, 6);
    expect(second.music).toBeCloseTo(second.weightedEnergy, 6);
    expect(second.waveformData).toBeInstanceOf(Uint8Array);
    expect(second.waveformData?.length).toBe(128);
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
      waveformData: waveformData(),
    });

    expect(update.bass).toBeCloseTo(0.75, 6);
    expect(update.mid).toBeCloseTo(update.mids, 6);
    expect(update.treb).toBeCloseTo(update.treble, 6);
    expect(update.mids).toBeCloseTo(0.4, 6);
    expect(update.treble).toBeCloseTo(0.25, 6);
    expect(update.bass_att).toBeCloseTo(update.bassAtt, 6);
    expect(update.mid_att).toBeCloseTo(update.midsAtt, 6);
    expect(update.treb_att).toBeCloseTo(update.trebleAtt, 6);
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
      waveformData: waveformData(),
    });
    tracker.update({
      time: 0.35,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: highEnergyData(),
      waveformData: waveformData(),
    });

    tracker.reset();

    const afterReset = tracker.update({
      time: 0.5,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: highEnergyData(),
      waveformData: waveformData(),
    });
    expect(afterReset.frame).toBe(1);
    expect(afterReset.bassAtt).toBeGreaterThanOrEqual(0);
  });
});
