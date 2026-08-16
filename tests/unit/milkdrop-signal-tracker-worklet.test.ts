import { describe, expect, test } from 'bun:test';
import type { FrequencyAnalyser } from '../../src/js/core/audio-handler.ts';
import { createMilkdropSignalTracker } from '../../src/js/milkdrop/runtime-signals.ts';

describe('createMilkdropSignalTracker with worklet beat detection', () => {
  test('updates signals in-place from worklet beat data without throwing', () => {
    const tracker = createMilkdropSignalTracker();
    const frequencyData = new Uint8Array(128).fill(120);

    const mockAnalyser: FrequencyAnalyser = {
      getFrequencyData: () => frequencyData,
      getWaveformData: () => frequencyData,
      getSpectralFeatures: () => ({
        spectralCentroid: 1200,
        spectralFlatness: 0.2,
        rms: 0.5,
      }),
      getWorkletBeatDetection: () => ({
        beatIntensity: 0.85,
        isBeat: true,
        beatBass: true,
        beatMid: false,
        beatTreble: true,
      }),
      getSpectralFlux: () => 0.4,
      getRmsLevel: () => 0.6,
      getSampleRate: () => 48000,
    } as unknown as FrequencyAnalyser;

    const signals1 = tracker.update({
      time: 1.0,
      deltaMs: 16.67,
      analyser: mockAnalyser,
      frequencyData,
    });

    expect(signals1.beat).toBe(1);
    expect(signals1.beatPulse).toBeCloseTo(0.85, 4);
    expect(signals1.beatBass).toBe(1);
    expect(signals1.beatTreble).toBe(1);
    expect(signals1.beatMid).toBe(0);
    expect(signals1.spectralFlux).toBeCloseTo(0.4, 4);

    const signals2 = tracker.update({
      time: 1.016,
      deltaMs: 16.67,
      analyser: mockAnalyser,
      frequencyData,
    });

    expect(signals2.beat).toBe(1);
    expect(signals2.beatPulse).toBeCloseTo(0.85, 4);
  });
});
