import { describe, expect, test } from 'bun:test';
import type { FrequencyAnalyser } from '../assets/js/core/audio-handler.ts';
import { createMilkdropSignalTracker } from '../assets/js/milkdrop/runtime-signals.ts';

function filledData(value: number, length = 128) {
  const data = new Uint8Array(length);
  data.fill(value);
  return data;
}

function pulseData({
  bass = 0,
  mid = 0,
  treble = 0,
  length = 128,
}: {
  bass?: number;
  mid?: number;
  treble?: number;
  length?: number;
}) {
  const data = new Uint8Array(length);
  data.fill(8);
  for (let index = 0; index < length; index += 1) {
    const ratio = index / Math.max(1, length - 1);
    const value = ratio < 0.12 ? bass : ratio < 0.5 ? mid : treble;
    data[index] = Math.round(value * 255);
  }
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

function highEnergyData() {
  return filledData(255);
}

describe('milkdrop runtime signals', () => {
  test('increments frame count and emits stable ranges with fallback data', () => {
    const tracker = createMilkdropSignalTracker();

    const quiet = tracker.update({
      time: 0,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: filledData(24),
      waveformData: waveformData(),
    });
    const pulse = tracker.update({
      time: 0.24,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: pulseData({ bass: 1, mid: 0.45, treble: 0.18 }),
      waveformData: waveformData(),
    });
    const sustain = tracker.update({
      time: 0.32,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: pulseData({ bass: 1, mid: 0.45, treble: 0.18 }),
      waveformData: waveformData(),
    });

    expect(quiet.frame).toBe(1);
    expect(pulse.frame).toBe(2);
    expect(quiet.weightedEnergy).toBeLessThanOrEqual(1);
    expect(pulse.bass).toBeGreaterThan(quiet.bass);
    expect(pulse.beat).toBe(1);
    expect(pulse.beatPulse).toBeGreaterThan(0.3);
    expect(sustain.beat).toBe(0);
    expect(sustain.beatPulse).toBeLessThan(pulse.beatPulse);
    expect(pulse.beat_pulse).toBe(pulse.beatPulse);
    expect(pulse.vol).toBeCloseTo(pulse.rms, 6);
    expect(pulse.music).toBeCloseTo(pulse.weightedEnergy, 6);
    expect(pulse.waveformData).toBeInstanceOf(Uint8Array);
    expect(pulse.waveformData?.length).toBe(128);
  });

  test('uses analyser-provided bands and smoothed RMS when available', () => {
    const tracker = createMilkdropSignalTracker();
    const analyserStub = {
      getMultiBandEnergy: () => ({ bass: 0.75, mid: 0.4, treble: 0.25 }),
      getRmsLevel: () => 0.8,
      getSampleRate: () => 48_000,
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
    expect(update.rms).toBeGreaterThan(0.2);
    expect(update.rms).toBeLessThan(0.4);
  });

  test('keeps attenuation followers energized after a bass transient', () => {
    const tracker = createMilkdropSignalTracker();

    tracker.update({
      time: 0,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: filledData(16),
      waveformData: waveformData(),
    });

    const pulse = tracker.update({
      time: 0.18,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: pulseData({ bass: 1, mid: 0.22, treble: 0.1 }),
      waveformData: waveformData(),
    });
    const release = tracker.update({
      time: 0.24,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: pulseData({ bass: 0.16, mid: 0.12, treble: 0.08 }),
      waveformData: waveformData(),
    });

    expect(pulse.bassAtt).toBeGreaterThan(0.25);
    expect(release.bassAtt).toBeGreaterThan(release.bass);
    expect(release.bassAtt).toBeLessThan(pulse.bassAtt);
  });

  test('builds MilkDrop spectrum samples from analyser-owned raw data', () => {
    const tracker = createMilkdropSignalTracker();
    const rawSpectrum = pulseData({ bass: 1, mid: 0.18, treble: 0.04 });
    const analyserStub = {
      getMultiBandEnergy: () => ({ bass: 0.68, mid: 0.3, treble: 0.12 }),
      getRmsLevel: () => 0.55,
      getSampleRate: () => 48_000,
      getFrequencyData: () => rawSpectrum,
    } as unknown as FrequencyAnalyser;

    const update = tracker.update({
      time: 0.2,
      deltaMs: 16.7,
      analyser: analyserStub,
      frequencyData: new Uint8Array(rawSpectrum.length),
      waveformData: waveformData(),
    });

    expect(update.frequencyData[0]).toBeGreaterThan(0);
    expect(update.frequencyData[0]).toBeGreaterThan(
      update.frequencyData[update.frequencyData.length - 1] ?? 0,
    );
  });

  test('normalizes quieter material so weighted energy still stays responsive', () => {
    const tracker = createMilkdropSignalTracker();
    tracker.update({
      time: 0,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: filledData(18),
      waveformData: waveformData(),
    });

    const quietPulse = tracker.update({
      time: 0.24,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: pulseData({ bass: 0.18, mid: 0.12, treble: 0.08 }),
      waveformData: waveformData(),
    });

    expect(quietPulse.weightedEnergy).toBeGreaterThan(0.2);
    expect(quietPulse.music).toBeCloseTo(quietPulse.weightedEnergy, 6);
  });

  test('reset restarts frame numbering and tracker state', () => {
    const tracker = createMilkdropSignalTracker();
    tracker.update({
      time: 0.1,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: pulseData({ bass: 1, mid: 0.4, treble: 0.2 }),
      waveformData: waveformData(),
    });
    tracker.update({
      time: 0.35,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: pulseData({ bass: 1, mid: 0.4, treble: 0.2 }),
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
