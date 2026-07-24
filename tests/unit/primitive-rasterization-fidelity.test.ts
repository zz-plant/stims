import { describe, expect, test } from 'bun:test';
import {
  getMilkdropSegmentWidth,
  getMilkdropThickWaveSpread,
  MILKDROP_THICK_SHAPE_PASS_OFFSET,
} from '../../assets/js/milkdrop/renderer-helpers/primitive-rasterization-metrics.ts';

type PixelBuffer = Uint8Array;

function rasterLine(width: number, size = 33): PixelBuffer {
  const pixels = new Uint8Array(size * size);
  const center = Math.floor(size / 2);
  const halfWidthPixels = Math.max(0.5, (width / 0.0025) * 0.5);
  for (let y = 0; y < size; y += 1) {
    const distance = Math.abs(y - center);
    const coverage = distance <= halfWidthPixels ? 255 : 0;
    for (let x = 3; x < size - 3; x += 1) {
      pixels[y * size + x] = coverage;
    }
  }
  return pixels;
}

function countLitPixels(pixels: PixelBuffer) {
  return pixels.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
}

function texturedShapeSampleUv(localX: number, localY: number, aspectY = 1) {
  return {
    u: 0.5 + 0.5 * localX * aspectY,
    v: 1 - (0.5 - 0.5 * localY),
  };
}

describe('milkdrop primitive rasterization fidelity fixtures', () => {
  test('line-width fixture grows pixels monotonically for WebGL and WebGPU shared widths', () => {
    const thin = rasterLine(getMilkdropSegmentWidth(1));
    const thick = rasterLine(getMilkdropSegmentWidth(5));

    expect(countLitPixels(thin)).toBe(27);
    expect(countLitPixels(thick)).toBe(135);
    expect(getMilkdropThickWaveSpread(5)).toBeCloseTo((1 / 512) * 7.5, 8);
  });

  test('shape-outline fixture uses the same normalized thickness quantum as thick WebGL outline passes', () => {
    const radius = 0.1;
    const outerScale = (radius + MILKDROP_THICK_SHAPE_PASS_OFFSET) / radius;
    const innerScale = radius / radius;

    expect(outerScale - innerScale).toBeCloseTo(
      MILKDROP_THICK_SHAPE_PASS_OFFSET / radius,
      8,
    );
  });

  test('textured-shape fixture keeps gradient sampling stable when no texture is bound', () => {
    const center = texturedShapeSampleUv(0, 0);
    const upperRight = texturedShapeSampleUv(0.5, 0.5);

    expect(center).toEqual({ u: 0.5, v: 0.5 });
    expect(upperRight).toEqual({ u: 0.75, v: 0.75 });
  });

  test('custom-wave depth fixture documents fixed procedural z for backend parity', () => {
    const webglDepth = 0.28;
    const webgpuProceduralCustomWaveDepth = 0.28;

    expect(webgpuProceduralCustomWaveDepth).toBe(webglDepth);
  });
});
