import { describe, expect, test } from 'bun:test';
import {
  CAS_GLSL_SNIPPET,
  CAS_WGSL_SNIPPET,
  getAdaptiveCasSharpness,
} from '../../src/js/core/shaders/cas.ts';

describe('FidelityFX Contrast-Adaptive Sharpening (CAS)', () => {
  test('exports valid shader snippets containing CAS algorithm', () => {
    expect(CAS_GLSL_SNIPPET).toContain('applyContrastAdaptiveSharpening');
    expect(CAS_GLSL_SNIPPET).toContain('minColor');
    expect(CAS_GLSL_SNIPPET).toContain('maxColor');

    expect(CAS_WGSL_SNIPPET).toContain('fn applyContrastAdaptiveSharpening');
    expect(CAS_WGSL_SNIPPET).toContain('texture_2d<f32>');
  });

  test('calculates adaptive sharpness based on render scale', () => {
    // At native 1.0x, sharpness is subtle
    expect(getAdaptiveCasSharpness(1.0)).toBeCloseTo(0.15, 2);

    // At 0.8x, sharpness scales up
    expect(getAdaptiveCasSharpness(0.8)).toBeGreaterThan(0.15);

    // At 0.6x, sharpness is high to restore downscaled edge details
    expect(getAdaptiveCasSharpness(0.6)).toBeCloseTo(0.85, 2);
  });
});
