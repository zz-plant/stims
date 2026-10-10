/**
 * Near-black frame analysis for the generated-preset visual gate: the
 * pixel maths over synthetic frames, and the verdict aggregation that
 * decides whether a freshly generated preset ever showed visible content.
 */
import { describe, expect, test } from 'bun:test';
import {
  checkStageForNearBlack,
  computeFrameLuminance,
  isNearBlackFrame,
  verdictFromLuminanceSamples,
} from '../../src/js/frontend/generated-preset-visual-check.ts';

function frame(pixels: number[], width: number, height: number) {
  const data = new Uint8ClampedArray(pixels);
  if (data.length !== width * height * 4) {
    throw new Error('fixture pixel count mismatch');
  }
  return data;
}

function solidFrame(width: number, height: number, value: number) {
  return frame(
    Array.from({ length: width * height }, () => [
      value,
      value,
      value,
      255,
    ]).flat(),
    width,
    height,
  );
}

describe('computeFrameLuminance', () => {
  test('a fully black frame reads as zero luminance and no visible pixels', () => {
    const metrics = computeFrameLuminance(solidFrame(8, 8, 0));
    expect(metrics.meanLuminance).toBe(0);
    expect(metrics.visiblePixelRatio).toBe(0);
  });

  test('a bright frame reads as high luminance and fully visible', () => {
    const metrics = computeFrameLuminance(solidFrame(8, 8, 255));
    expect(metrics.meanLuminance).toBeGreaterThan(200);
    expect(metrics.visiblePixelRatio).toBe(1);
  });

  test('a mostly-dark frame with one lit pixel reports the lit pixel', () => {
    const width = 10;
    const height = 10;
    const pixels = solidFrame(width, height, 0);
    const litIndex = (5 * width + 5) * 4;
    pixels[litIndex] = 255;
    pixels[litIndex + 1] = 255;
    pixels[litIndex + 2] = 255;
    const metrics = computeFrameLuminance(pixels);
    expect(metrics.visiblePixelRatio).toBeCloseTo(0.01, 10);
    expect(metrics.meanLuminance).toBeGreaterThan(0);
  });

  test('an empty buffer reads as zero, not NaN', () => {
    const metrics = computeFrameLuminance(new Uint8ClampedArray(0));
    expect(metrics.meanLuminance).toBe(0);
    expect(metrics.visiblePixelRatio).toBe(0);
  });
});

describe('isNearBlackFrame and verdict aggregation', () => {
  test('black frames are near-black, bright frames are not', () => {
    expect(isNearBlackFrame({ meanLuminance: 0, visiblePixelRatio: 0 })).toBe(
      true,
    );
    expect(
      isNearBlackFrame({ meanLuminance: 30, visiblePixelRatio: 0.5 }),
    ).toBe(false);
  });

  test('a dark mean with too many lit pixels is not near-black', () => {
    // A sparse starfield: mean luminance under the threshold, but 1% of
    // pixels lit — visible content, not a collapse.
    expect(
      isNearBlackFrame({ meanLuminance: 1.5, visiblePixelRatio: 0.01 }),
    ).toBe(false);
  });

  test('any lit frame clears the whole window', () => {
    const samples = [
      { meanLuminance: 0, visiblePixelRatio: 0 },
      { meanLuminance: 40, visiblePixelRatio: 0.2 },
      { meanLuminance: 0, visiblePixelRatio: 0 },
    ];
    expect(verdictFromLuminanceSamples(samples)).toBe('ok');
  });

  test('an all-dark window is condemned as near-black', () => {
    const samples = [
      { meanLuminance: 0.5, visiblePixelRatio: 0 },
      { meanLuminance: 1, visiblePixelRatio: 0.001 },
    ];
    expect(verdictFromLuminanceSamples(samples)).toBe('near-black');
  });

  test('no readable samples is unknown, never a pass or a fail', () => {
    expect(verdictFromLuminanceSamples([])).toBe('unknown');
  });
});

describe('checkStageForNearBlack', () => {
  test('reports unknown when there is no stage canvas, without waiting', async () => {
    const container = document.createElement('div');
    await expect(checkStageForNearBlack(container)).resolves.toBe('unknown');
    await expect(checkStageForNearBlack(null)).resolves.toBe('unknown');
  });
});
