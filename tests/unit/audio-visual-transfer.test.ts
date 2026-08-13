import { describe, expect, it } from 'bun:test';
import {
  autonomyVariance,
  crossCorrelationLag,
  decayPersistenceFrames,
  pearsonCorrelation,
} from '../../scripts/audio-visual-transfer.ts';
import { stimulusEnergyAtFrame } from '../../src/js/core/testing/synthetic-stimulus.ts';

function ramp(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i / (n - 1));
}

describe('pearsonCorrelation', () => {
  it('is ~1 for a perfectly linear relationship', () => {
    const a = ramp(50);
    const b = a.map((v) => v * 2 + 3);
    expect(pearsonCorrelation(a, b)).toBeCloseTo(1, 5);
  });

  it('is ~-1 for an inverted relationship', () => {
    const a = ramp(50);
    const b = a.map((v) => -v);
    expect(pearsonCorrelation(a, b)).toBeCloseTo(-1, 5);
  });

  it('is ~0 for series with no linear relationship', () => {
    const n = 200;
    const a = Array.from({ length: n }, (_, i) =>
      Math.sin((i / n) * Math.PI * 6),
    );
    const b = Array.from({ length: n }, (_, i) =>
      Math.sin((i / n) * Math.PI * 17 + 1.3),
    );
    expect(Math.abs(pearsonCorrelation(a, b))).toBeLessThan(0.15);
  });

  it('returns 0 rather than NaN for a constant series', () => {
    const a = new Array(20).fill(0.5);
    const b = ramp(20);
    expect(pearsonCorrelation(a, b)).toBe(0);
  });

  it('returns 0 for fewer than 2 points', () => {
    expect(pearsonCorrelation([1], [1])).toBe(0);
    expect(pearsonCorrelation([], [])).toBe(0);
  });
});

describe('crossCorrelationLag', () => {
  it('finds an exact delay between stimulus and response', () => {
    const n = 300;
    const delay = 12;
    const stimulus = Array.from({ length: n }, (_, i) =>
      stimulusEnergyAtFrame(
        { type: 'transient', atFrame: 100, widthFrames: 30, magnitude: 1 },
        i,
        n,
      ),
    );
    const response = Array.from({ length: n }, (_, i) =>
      i >= delay ? stimulus[i - delay] : 0,
    );
    const result = crossCorrelationLag(stimulus, response, 40);
    expect(result.lagFrames).toBe(delay);
    expect(result.correlation).toBeGreaterThan(0.9);
  });

  it('reports zero lag when response tracks stimulus with no delay', () => {
    // A monotonic ramp is a bad fixture here: every lag of a linear ramp
    // against a shifted slice of itself is *also* perfectly correlated
    // (r=1), so there's no unique optimum to find and the result is at the
    // mercy of floating-point noise between lags. A transient has a real,
    // distinctive shape, so only the true (zero) lag maximizes correlation.
    const n = 200;
    const stimulus = Array.from({ length: n }, (_, i) =>
      stimulusEnergyAtFrame(
        { type: 'transient', atFrame: 100, widthFrames: 25, magnitude: 1 },
        i,
        n,
      ),
    );
    const response = stimulus.map((v) => v * 0.8);
    const result = crossCorrelationLag(stimulus, response, 20);
    expect(result.lagFrames).toBe(0);
  });
});

describe('decayPersistenceFrames', () => {
  it('measures frames to return within tolerance of the pre-stimulus baseline', () => {
    const baseline = 0.1;
    const peakFrame = 20;
    const decayFrames = 15;
    const response = Array.from({ length: 60 }, (_, i) => {
      if (i < peakFrame) return baseline;
      const t = Math.max(0, i - peakFrame) / decayFrames;
      return baseline + Math.max(0, 1 - t) * (1 - baseline);
    });
    const result = decayPersistenceFrames(response, peakFrame, baseline, 0.05);
    expect(result).not.toBeNull();
    expect(result as number).toBeGreaterThanOrEqual(decayFrames - 2);
    expect(result as number).toBeLessThanOrEqual(decayFrames + 2);
  });

  it('returns 0 when there is no swing to decay from', () => {
    const response = new Array(30).fill(0.2);
    expect(decayPersistenceFrames(response, 10, 0.2, 0.1)).toBe(0);
  });

  it('returns null when the response never decays within the window', () => {
    const response = new Array(30).fill(1);
    expect(decayPersistenceFrames(response, 5, 0, 0.05)).toBeNull();
  });
});

describe('autonomyVariance', () => {
  it('is ~0 for a perfectly static response', () => {
    expect(autonomyVariance(new Array(50).fill(0.3))).toBeCloseTo(0, 10);
  });

  it('is positive for a response that moves without a driving stimulus', () => {
    const response = Array.from(
      { length: 100 },
      (_, i) => 0.3 + Math.sin(i * 0.3) * 0.1,
    );
    expect(autonomyVariance(response)).toBeGreaterThan(0.05);
  });
});
