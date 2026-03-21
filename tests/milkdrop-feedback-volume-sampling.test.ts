import { describe, expect, test } from 'bun:test';
import {
  AUX_TEXTURE_ATLAS_SLICE_COUNT,
  getWrappedAtlasSliceSample,
} from '../assets/js/milkdrop/feedback-volume-sampling.ts';

describe('milkdrop feedback volume atlas sampling', () => {
  test('keeps modulo-equivalent tex3D phases on the same atlas position', () => {
    const inRange = getWrappedAtlasSliceSample(0.2);
    const wrapped = getWrappedAtlasSliceSample(1.2);
    const negativeWrapped = getWrappedAtlasSliceSample(-0.8);

    expect(inRange.scaledSlice).toBeCloseTo(12.8, 6);
    expect(wrapped.scaledSlice).toBeCloseTo(inRange.scaledSlice, 6);
    expect(negativeWrapped.scaledSlice).toBeCloseTo(inRange.scaledSlice, 6);
    expect(wrapped.sliceIndexA).toBe(inRange.sliceIndexA);
    expect(wrapped.sliceIndexB).toBe(inRange.sliceIndexB);
    expect(wrapped.sliceBlend).toBeCloseTo(inRange.sliceBlend, 6);
  });

  test('blends the last atlas slice back to slice zero before the phase wraps', () => {
    const nearWrap = getWrappedAtlasSliceSample(0.99);
    const wrapped = getWrappedAtlasSliceSample(1);

    expect(nearWrap.sliceIndexA).toBe(AUX_TEXTURE_ATLAS_SLICE_COUNT - 1);
    expect(nearWrap.sliceIndexB).toBe(0);
    expect(nearWrap.sliceBlend).toBeGreaterThan(0);
    expect(wrapped.scaledSlice).toBe(0);
    expect(wrapped.sliceIndexA).toBe(0);
    expect(wrapped.sliceIndexB).toBe(1);
  });
});
