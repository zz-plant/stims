import { describe, expect, test } from 'bun:test';
import { createAudioReactivityInterpolator } from '../../src/js/core/audio-interpolator.ts';

describe('AudioReactivityInterpolator', () => {
  test('returns zeros before any samples are pushed', () => {
    const interpolator = createAudioReactivityInterpolator();
    const result = interpolator.sample(100);
    expect(result).toEqual({ bass: 0, mid: 0, treble: 0, rms: 0 });
  });

  test('returns first sample values when only one sample exists', () => {
    const interpolator = createAudioReactivityInterpolator();
    interpolator.pushSample(
      { bass: 1.0, mid: 0.5, treble: 0.2, rms: 0.6 },
      100,
    );

    const result = interpolator.sample(150);
    expect(result).toEqual({ bass: 1.0, mid: 0.5, treble: 0.2, rms: 0.6 });
  });

  test('smoothly interpolates between two keyframes', () => {
    const interpolator = createAudioReactivityInterpolator();
    interpolator.pushSample({ bass: 0.0, mid: 0.0, treble: 0.0, rms: 0.0 }, 0);
    interpolator.pushSample(
      { bass: 1.0, mid: 2.0, treble: 3.0, rms: 1.5 },
      100,
    );

    const midpoint = interpolator.sample(50);
    expect(midpoint.bass).toBeGreaterThan(0.2);
    expect(midpoint.bass).toBeLessThan(0.8);
    expect(midpoint.mid).toBeGreaterThan(0.5);
    expect(midpoint.mid).toBeLessThan(1.5);
    expect(midpoint.treble).toBeGreaterThan(0.8);
    expect(midpoint.treble).toBeLessThan(2.5);
  });

  test('resets history cleanly', () => {
    const interpolator = createAudioReactivityInterpolator();
    interpolator.pushSample(
      { bass: 1.0, mid: 1.0, treble: 1.0, rms: 1.0 },
      100,
    );
    interpolator.reset();

    expect(interpolator.sample(200)).toEqual({
      bass: 0,
      mid: 0,
      treble: 0,
      rms: 0,
    });
  });
});
