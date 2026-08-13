import { describe, expect, test } from 'bun:test';
import { createHarmonicPercussiveAnalyser } from '../../src/js/utils/audio/harmonic-percussive.ts';

const SAMPLE_RATE = 48_000;
const BINS = 512;
const BIN_HZ = SAMPLE_RATE / 2 / BINS;

/** A steady tone: one narrow spectral peak, unchanging frame to frame. The
 * right answer is "harmonic": sustained in time, narrow in frequency. */
function toneSpectrum(hz: number, level = 240) {
  const data = new Uint8Array(BINS);
  const peak = Math.round(hz / BIN_HZ);
  for (let i = -1; i <= 1; i += 1) {
    const bin = peak + i;
    if (bin >= 0 && bin < BINS) {
      data[bin] = i === 0 ? level : Math.round(level * 0.5);
    }
  }
  return data;
}

/** A click: broadband energy in a single frame. The right answer is
 * "percussive": broadband in frequency, transient in time. */
function clickSpectrum(level = 200) {
  const data = new Uint8Array(BINS);
  data.fill(level);
  return data;
}

function silence() {
  return new Uint8Array(BINS);
}

/** Direct current: all energy in bin 0, steady. Must not blow up. */
function dcSpectrum() {
  const data = new Uint8Array(BINS);
  data[0] = 255;
  return data;
}

function allFinite(levels: Record<string, number>) {
  return Object.values(levels).every((value) => Number.isFinite(value));
}

describe('harmonic/percussive decomposition (median-filter HPSS)', () => {
  test('a sustained pure tone reads as harmonic, with near-zero percussive energy', () => {
    const analyser = createHarmonicPercussiveAnalyser();
    let levels = analyser.analyse(silence(), SAMPLE_RATE);
    for (let frame = 0; frame < 20; frame += 1) {
      levels = analyser.analyse(toneSpectrum(1_000), SAMPLE_RATE);
    }
    expect(levels.harmonic).toBeGreaterThan(levels.percussive * 5);
    expect(levels.percussiveRatio).toBeLessThan(0.2);
  });

  test('an isolated click reads as percussive, with near-zero harmonic energy', () => {
    const analyser = createHarmonicPercussiveAnalyser();
    for (let frame = 0; frame < 12; frame += 1) {
      analyser.analyse(silence(), SAMPLE_RATE);
    }
    const levels = analyser.analyse(clickSpectrum(), SAMPLE_RATE);
    expect(levels.percussive).toBeGreaterThan(levels.harmonic * 5);
    expect(levels.percussiveRatio).toBeGreaterThan(0.8);
  });

  test('a click train stays percussive across repeats', () => {
    const analyser = createHarmonicPercussiveAnalyser();
    const ratios: number[] = [];
    for (let frame = 0; frame < 40; frame += 1) {
      // One click every 6th frame; silence in between.
      const spectrum = frame % 6 === 0 ? clickSpectrum() : silence();
      const levels = analyser.analyse(spectrum, SAMPLE_RATE);
      if (frame > 6 && frame % 6 === 0) {
        ratios.push(levels.percussiveRatio);
      }
    }
    expect(ratios.length).toBeGreaterThan(3);
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThan(0.7);
    }
  });

  test('a tone-plus-click mixture reports both, and each component tracks its own part', () => {
    const analyser = createHarmonicPercussiveAnalyser();
    // Establish the tone first so the time-median has sustained history.
    let levels = analyser.analyse(silence(), SAMPLE_RATE);
    for (let frame = 0; frame < 20; frame += 1) {
      levels = analyser.analyse(toneSpectrum(1_000), SAMPLE_RATE);
    }
    const toneOnlyHarmonic = levels.harmonic;
    const toneOnlyPercussive = levels.percussive;

    const mixture = toneSpectrum(1_000);
    const click = clickSpectrum(160);
    for (let i = 0; i < BINS; i += 1) {
      mixture[i] = Math.min(255, mixture[i] + click[i]);
    }
    const mixed = analyser.analyse(mixture, SAMPLE_RATE);

    // Both components are present...
    expect(mixed.harmonic).toBeGreaterThan(0);
    expect(mixed.percussive).toBeGreaterThan(0);
    // ...the percussive part jumped because a broadband transient arrived...
    expect(mixed.percussive).toBeGreaterThan(toneOnlyPercussive * 3);
    // ...and the harmonic part did not collapse: the tone is still there.
    expect(mixed.harmonic).toBeGreaterThan(toneOnlyHarmonic * 0.5);
  });

  test('low-band percussive responds to a low-frequency transient, not a high one', () => {
    const lowAnalyser = createHarmonicPercussiveAnalyser();
    const highAnalyser = createHarmonicPercussiveAnalyser();
    for (let frame = 0; frame < 12; frame += 1) {
      lowAnalyser.analyse(silence(), SAMPLE_RATE);
      highAnalyser.analyse(silence(), SAMPLE_RATE);
    }

    // Broadband burst confined to 20-250 Hz vs one confined above 4 kHz.
    const lowBurst = new Uint8Array(BINS);
    for (let i = 1; i < Math.ceil(250 / BIN_HZ); i += 1) lowBurst[i] = 220;
    const highBurst = new Uint8Array(BINS);
    for (let i = Math.ceil(4_000 / BIN_HZ); i < BINS; i += 1)
      highBurst[i] = 220;

    const low = lowAnalyser.analyse(lowBurst, SAMPLE_RATE);
    const high = highAnalyser.analyse(highBurst, SAMPLE_RATE);

    expect(low.percussiveLow).toBeGreaterThan(high.percussiveLow);
    expect(high.percussiveHigh).toBeGreaterThan(low.percussiveHigh);
  });

  describe('degenerate inputs stay finite', () => {
    test('silence yields zero energy and a neutral 0.5 ratio, never NaN', () => {
      const analyser = createHarmonicPercussiveAnalyser();
      for (let frame = 0; frame < 10; frame += 1) {
        const levels = analyser.analyse(silence(), SAMPLE_RATE);
        expect(allFinite(levels)).toBe(true);
        expect(levels.percussive).toBe(0);
        expect(levels.harmonic).toBe(0);
        expect(levels.percussiveRatio).toBe(0.5);
      }
    });

    test('the very first frame, with no history, is finite', () => {
      const analyser = createHarmonicPercussiveAnalyser();
      const levels = analyser.analyse(toneSpectrum(440), SAMPLE_RATE);
      expect(allFinite(levels)).toBe(true);
      // With one frame of history the time-median is the frame itself, so the
      // frame reads as harmonic rather than as a transient.
      expect(levels.harmonic).toBeGreaterThan(levels.percussive);
    });

    test('DC-only input is finite', () => {
      const analyser = createHarmonicPercussiveAnalyser();
      for (let frame = 0; frame < 10; frame += 1) {
        const levels = analyser.analyse(dcSpectrum(), SAMPLE_RATE);
        expect(allFinite(levels)).toBe(true);
      }
    });

    test('full-scale, empty, and single-bin buffers are finite', () => {
      const analyser = createHarmonicPercussiveAnalyser();
      const saturated = new Uint8Array(BINS).fill(255);
      for (let frame = 0; frame < 10; frame += 1) {
        expect(allFinite(analyser.analyse(saturated, SAMPLE_RATE))).toBe(true);
      }
      expect(allFinite(analyser.analyse(new Uint8Array(0), SAMPLE_RATE))).toBe(
        true,
      );
      expect(
        allFinite(analyser.analyse(new Uint8Array([200]), SAMPLE_RATE)),
      ).toBe(true);
    });

    test('a zero or non-finite sample rate is rejected without NaN', () => {
      const analyser = createHarmonicPercussiveAnalyser();
      expect(allFinite(analyser.analyse(clickSpectrum(), 0))).toBe(true);
      expect(allFinite(analyser.analyse(clickSpectrum(), Number.NaN))).toBe(
        true,
      );
    });

    test('a buffer-length change mid-stream does not leak stale history', () => {
      const analyser = createHarmonicPercussiveAnalyser();
      for (let frame = 0; frame < 8; frame += 1) {
        analyser.analyse(clickSpectrum(), SAMPLE_RATE);
      }
      const levels = analyser.analyse(new Uint8Array(1_024), SAMPLE_RATE);
      expect(allFinite(levels)).toBe(true);
      expect(levels.percussive).toBe(0);
    });
  });
});
