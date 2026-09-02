import { describe, expect, test } from 'bun:test';
import { fillReferenceAudioWaveform } from '../../src/js/core/testing/reference-audio';
import type { MilkdropRuntimeSignals } from '../../src/js/milkdrop/types';
import {
  fillCustomWaveSampleValues,
  getMilkdropWaveChannels,
} from '../../src/js/milkdrop/vm/custom-wave-samples';

/**
 * These numbers are a MEASUREMENT of native projectM, not a snapshot of our own
 * output — see the note in custom-wave-samples.ts for the method (a probe
 * preset that writes value2 to screen position, captured through
 * `parity:capture:projectm-native --audio tones` and decoded per image column,
 * with brackets at k=1/5/10 agreeing to 1.6%).
 *
 * If a change here goes red, our custom waves have stopped agreeing with the
 * oracle. Re-run the probe before touching the expectations.
 */
const PROJECTM = {
  spectrumPeak: 0.0751,
  spectrumPeakDoubleScaling: 0.1508,
  waveformPeak: 0.215,
};

function referenceSignals(frameIndex: number): MilkdropRuntimeSignals {
  // 512 samples is what the deterministic capture path hands the VM.
  const waveformData = new Uint8Array(512);
  fillReferenceAudioWaveform(waveformData, frameIndex);
  return {
    frame: frameIndex,
    waveformData,
  } as unknown as MilkdropRuntimeSignals;
}

function peak(spectrum: boolean, scaling: number, smoothing = 0) {
  const signals = referenceSignals(30);
  const value1 = new Float32Array(512);
  const value2 = new Float32Array(512);
  const count = fillCustomWaveSampleValues(
    getMilkdropWaveChannels(signals, spectrum),
    { sampleCount: 512, separation: 0, spectrum, scaling, smoothing },
    value1,
    value2,
  );
  let max = 0;
  for (let i = 0; i < count; i += 1) {
    max = Math.max(max, Math.abs(value2[i]));
  }
  return max;
}

describe('custom wave value1/value2', () => {
  test('reproduces projectM spectrum magnitude for the reference tones', () => {
    expect(peak(true, 1)).toBeCloseTo(PROJECTM.spectrumPeak, 3);
  });

  // projectM's own control sweep: doubling the wave's `scaling` doubled the
  // values (x2.007), while doubling fWaveScale changed nothing at all.
  test('scales linearly with the wave scaling field', () => {
    // The probe's own brackets only agreed to 1.6%, so compare against the
    // oracle loosely and pin the exact doubling separately.
    expect(peak(true, 2)).toBeCloseTo(PROJECTM.spectrumPeakDoubleScaling, 2);
    expect(peak(true, 2) / peak(true, 1)).toBeCloseTo(2, 6);
  });

  test('reproduces projectM waveform amplitude for the reference tones', () => {
    expect(peak(false, 1)).toBeCloseTo(PROJECTM.waveformPeak, 2);
  });

  test('smoothing flattens the spectrum peak', () => {
    // projectM measured 0.230 of the unsmoothed peak at smoothing 0.9; we reach
    // 0.139, a known residual recorded in custom-wave-samples.ts. Pin the
    // direction and rough magnitude, not a number we have not matched.
    const ratio = peak(true, 1, 0.9) / peak(true, 1);
    expect(ratio).toBeLessThan(0.5);
    expect(ratio).toBeGreaterThan(0.05);
  });

  test('separates the two channels instead of aliasing them', () => {
    const signals = {
      ...referenceSignals(30),
      waveformDataL: new Uint8Array(512).fill(228),
      waveformDataR: new Uint8Array(512).fill(28),
    } as unknown as MilkdropRuntimeSignals;
    const value1 = new Float32Array(64);
    const value2 = new Float32Array(64);
    fillCustomWaveSampleValues(
      getMilkdropWaveChannels(signals, false),
      {
        sampleCount: 64,
        separation: 0,
        spectrum: false,
        scaling: 1,
        smoothing: 0,
      },
      value1,
      value2,
    );
    // +100 and -100 signed, times the measured 0.002 waveform constant.
    expect(value1[10]).toBeCloseTo(0.2, 4);
    expect(value2[10]).toBeCloseTo(-0.2, 4);
  });

  test('treats a never-written waveform buffer as silence, not DC', () => {
    // A zero-filled byte buffer means "nothing wrote here". Reading it as PCM
    // would make every sample -128 and inject a full-scale DC spike.
    const signals = {
      frame: 7,
      waveformData: new Uint8Array(512),
    } as unknown as MilkdropRuntimeSignals;
    const value1 = new Float32Array(64);
    const value2 = new Float32Array(64);
    fillCustomWaveSampleValues(
      getMilkdropWaveChannels(signals, false),
      {
        sampleCount: 64,
        separation: 0,
        spectrum: false,
        scaling: 1,
        smoothing: 0,
      },
      value1,
      value2,
    );
    expect(value1[10]).toBe(0);
    expect(value2[10]).toBe(0);
  });
});
