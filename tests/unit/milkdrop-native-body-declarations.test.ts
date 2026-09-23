import { describe, expect, test } from 'bun:test';
import { extractNativeShaderBody } from '../../src/js/milkdrop/compiler/shader-analysis.ts';

/**
 * Declarations above `shader_body` are carried into the executable body.
 * They are HLSL like the body is, so they go through the same HLSL→GLSL
 * normaliser — a raw `float2 rs;` was a GLSL syntax error.
 */
describe('native shader body pre-body declarations', () => {
  test('are normalised to GLSL types', () => {
    const body = extractNativeShaderBody(
      'sampler sampler_pw_noise_lq; float2 rs; float pads; shader_body { rs = uv; ret = rs.xxy; }',
    );
    expect(body).toContain('vec2 rs;');
    expect(body).not.toContain('float2');
    expect(body).toContain('float pads;');
  });
});
