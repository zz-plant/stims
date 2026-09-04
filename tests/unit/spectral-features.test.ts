import { describe, expect, it } from 'bun:test';
import {
  computeRms,
  computeSpectralCentroid,
  computeSpectralFlatness,
  computeSpectralRolloff,
  extractSpectralFeatures,
} from '../../src/js/utils/audio/spectral-features.ts';

describe('spectral-features', () => {
  describe('computeRms', () => {
    it('returns 0 for empty array', () => {
      expect(computeRms(new Float32Array(0))).toBe(0);
    });

    it('returns 0 for silence', () => {
      const silence = new Float32Array(1024);
      expect(computeRms(silence)).toBe(0);
    });

    it('returns 1 for constant DC signal of 1', () => {
      const dc = new Float32Array(512).fill(1);
      expect(computeRms(dc)).toBeCloseTo(1, 4);
    });

    it('returns approximately 1/sqrt(2) for a pure sine wave of amplitude 1', () => {
      const N = 1024;
      const sine = new Float32Array(N);
      for (let i = 0; i < N; i += 1) {
        sine[i] = Math.sin((2 * Math.PI * i) / N);
      }
      expect(computeRms(sine)).toBeCloseTo(1 / Math.SQRT2, 3);
    });
  });

  describe('computeSpectralCentroid', () => {
    it('returns 0 for silence', () => {
      const silence = new Float32Array(512);
      expect(computeSpectralCentroid(silence, 44100, 1024)).toBe(0);
    });

    it('returns the exact frequency of a single bin peak', () => {
      const sampleRate = 44100;
      const fftSize = 1024;
      const binWidth = sampleRate / fftSize;
      const targetBin = 10;
      const amps = new Float32Array(512);
      amps[targetBin] = 1.0;

      const centroid = computeSpectralCentroid(amps, sampleRate, fftSize);
      expect(centroid).toBeCloseTo(targetBin * binWidth, 3);
    });

    it('scales linearly between two symmetric peaks', () => {
      const sampleRate = 44100;
      const fftSize = 1024;
      const binWidth = sampleRate / fftSize;
      const amps = new Float32Array(512);
      amps[10] = 1.0;
      amps[20] = 1.0;

      const centroid = computeSpectralCentroid(amps, sampleRate, fftSize);
      expect(centroid).toBeCloseTo(15 * binWidth, 3);
    });
  });

  describe('computeSpectralFlatness', () => {
    it('returns 0 for silence', () => {
      expect(computeSpectralFlatness(new Float32Array(512))).toBe(0);
    });

    it('returns 1.0 for a completely flat white noise spectrum', () => {
      const flat = new Float32Array(512).fill(0.5);
      expect(computeSpectralFlatness(flat)).toBeCloseTo(1.0, 3);
    });

    it('returns near 0 for a tonal peak spectrum', () => {
      const tonal = new Float32Array(512).fill(1e-6);
      tonal[25] = 1.0;
      const flatness = computeSpectralFlatness(tonal);
      expect(flatness).toBeLessThan(0.05);
    });
  });

  describe('computeSpectralRolloff', () => {
    it('returns 0 for silence', () => {
      expect(computeSpectralRolloff(new Float32Array(512), 44100, 1024)).toBe(
        0,
      );
    });

    it('returns 85% bandwidth for a uniform spectrum', () => {
      const sampleRate = 44100;
      const fftSize = 1024;
      const binWidth = sampleRate / fftSize;
      const bins = 512;
      const flat = new Float32Array(bins).fill(1.0);

      const rolloff = computeSpectralRolloff(flat, sampleRate, fftSize, 0.85);
      const expectedBin = Math.floor(bins * 0.85);
      expect(rolloff).toBeCloseTo(expectedBin * binWidth, 1);
    });
  });

  describe('extractSpectralFeatures', () => {
    it('extracts all features concurrently into a valid snapshot', () => {
      const timeDomain = new Float32Array(1024).fill(0.1);
      const amps = new Float32Array(512).fill(0.2);
      const snapshot = extractSpectralFeatures(timeDomain, amps, 44100, 1024);

      expect(Number.isFinite(snapshot.rms)).toBe(true);
      expect(Number.isFinite(snapshot.spectralCentroid)).toBe(true);
      expect(Number.isFinite(snapshot.spectralFlatness)).toBe(true);
      expect(Number.isFinite(snapshot.spectralRolloff)).toBe(true);
      expect(snapshot.rms).toBeCloseTo(0.1, 4);
    });
  });
});
