import { describe, expect, test } from 'bun:test';
import {
  calculateTemporalBlendWeight,
  TEMPORAL_CLAMPING_GLSL_SNIPPET,
  TEMPORAL_CLAMPING_WGSL_SNIPPET,
} from '../../src/js/core/shaders/temporal-reconstruction.ts';

describe('Temporal History Neighborhood Clamping', () => {
  test('exports valid GLSL and WGSL snippets for 3x3 AABB neighborhood clamping', () => {
    expect(TEMPORAL_CLAMPING_GLSL_SNIPPET).toContain(
      'sampleNeighborhoodMinMaxClamp',
    );
    expect(TEMPORAL_CLAMPING_GLSL_SNIPPET).toContain('minColor');
    expect(TEMPORAL_CLAMPING_GLSL_SNIPPET).toContain('maxColor');

    expect(TEMPORAL_CLAMPING_WGSL_SNIPPET).toContain(
      'fn sampleNeighborhoodMinMaxClamp',
    );
    expect(TEMPORAL_CLAMPING_WGSL_SNIPPET).toContain('texture_2d<f32>');
  });

  test('calculates motion-dependent blend weights', () => {
    // Static / low-motion scene: higher history weight (0.12 alpha on current frame)
    expect(calculateTemporalBlendWeight(0)).toBeCloseTo(0.12, 2);

    // Fast motion increases weight on current frame to avoid ghosting
    const rapidMotionWeight = calculateTemporalBlendWeight(0.4);
    expect(rapidMotionWeight).toBeGreaterThan(0.5);
    expect(rapidMotionWeight).toBeLessThanOrEqual(0.85);
  });
});
