/**
 * Guards the waveform-side of the audio scale contract. The spectrum path is
 * dB-scaled and band-normalized, so a quiet source still produces healthy
 * band levels — but presets also draw the raw byte waveform, and a quiet
 * source parks every byte at 128 +/- a few counts: every waveform-centric
 * preset (the classic Geiss catalog among them) renders a flat line while the
 * bands keep insisting the music is loud. `createWaveformAutoGain` closes
 * that gap; these tests pin its contract.
 */

import { describe, expect, test } from 'bun:test';
import { createWaveformAutoGain } from '../../src/js/utils/audio/reactivity.ts';

function sineWaveform(amplitude: number, length = 256): Uint8Array {
  const data = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.round(
      128 + amplitude * Math.sin((i / length) * Math.PI * 8),
    );
  }
  return data;
}

function peakDeviation(data: Uint8Array): number {
  let peak = 0;
  for (const value of data) {
    peak = Math.max(peak, Math.abs(value - 128));
  }
  return peak;
}

describe('createWaveformAutoGain', () => {
  test('boosts a quiet wave toward the target amplitude', () => {
    const agc = createWaveformAutoGain();
    // The demo track reaches the analyser at ~0.12 of full scale: ~15 counts.
    const quiet = sineWaveform(15);
    const gain = agc.measure(quiet);
    expect(gain).toBeGreaterThan(4);

    const output = new Uint8Array(quiet.length);
    agc.apply(quiet, output, gain);
    expect(peakDeviation(output)).toBeGreaterThan(70);
    expect(peakDeviation(output)).toBeLessThanOrEqual(127);
  });

  test('leaves a full-scale wave untouched', () => {
    const agc = createWaveformAutoGain();
    expect(agc.measure(sineWaveform(110))).toBe(1);
  });

  test('does not amplify silence into garbage', () => {
    const agc = createWaveformAutoGain();
    expect(agc.measure(sineWaveform(1))).toBe(1);
  });

  test('caps amplification for barely-audible input', () => {
    const agc = createWaveformAutoGain({ maxGain: 8 });
    const gain = agc.measure(sineWaveform(5));
    expect(gain).toBeLessThanOrEqual(8);
  });

  test('drops gain instantly when the source gets loud, recovers gradually', () => {
    const agc = createWaveformAutoGain();
    const quietGain = agc.measure(sineWaveform(15));
    expect(quietGain).toBeGreaterThan(1);

    // Loud transient: attack is instantaneous, so the very same frame is no
    // longer over-amplified.
    expect(agc.measure(sineWaveform(120))).toBe(1);

    // Back to quiet: the tracked peak decays over many frames rather than
    // snapping, so the wave grows back smoothly instead of flickering.
    const nextGain = agc.measure(sineWaveform(15));
    expect(nextGain).toBeGreaterThanOrEqual(1);
    expect(nextGain).toBeLessThan(quietGain);
    let gain = nextGain;
    for (let i = 0; i < 600; i += 1) {
      gain = agc.measure(sineWaveform(15));
    }
    expect(gain).toBeGreaterThan(4);
  });

  test('apply clamps to the byte range', () => {
    const agc = createWaveformAutoGain();
    const input = sineWaveform(40);
    const output = new Uint8Array(input.length);
    agc.apply(input, output, 8);
    for (const value of output) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
    }
  });
});
