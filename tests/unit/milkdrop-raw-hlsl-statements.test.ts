import { describe, expect, test } from 'bun:test';
import {
  extractNativeShaderBody,
  normalizeHlslToGlsl,
} from '../../src/js/milkdrop/compiler/shader-analysis.ts';

/**
 * Statement-level HLSL→GLSL rewrites on the raw (hlsl2glsl-style) path.
 * Each is HLSL behaviour GLSL ES lacks; the offline GLSL corpus scan is
 * the measurement, these pin the shapes.
 */
describe('raw HLSL statement rewrites', () => {
  test('tex2D becomes texture2D', () => {
    expect(normalizeHlslToGlsl('ret = tex2D(sampler_main, uv).xyz;')).toContain(
      'texture2D(currentTex, uv)',
    );
  });

  test('mul(x, y) swaps its operands (HLSL rows vs GLSL columns)', () => {
    expect(
      normalizeHlslToGlsl('zz = mul(zz, float2x2(q1, q2, q3, q4));'),
    ).toContain('milkdropMul(mat2(q1, q2, q3, q4), zz)');
  });

  test('integer literals become float literals outside int contexts', () => {
    const glsl = normalizeHlslToGlsl('float z = 1/(uv1.y); rs0.x = rs0.x * 1;');
    expect(glsl).toContain('1.0/(uv1.y)');
    expect(glsl).toContain('rs0.x * 1.0');
  });

  test('int variables keep their integer literals', () => {
    const declared = normalizeHlslToGlsl('int n; n = 0; x = n < 6;');
    expect(declared).toContain('n = 0;');
    expect(declared).toContain('n < 6');
    // hlsl2glsl sometimes drops the declaration; a name only ever assigned
    // integer literals is the hoister's int signal, so it is kept too.
    const undeclared = normalizeHlslToGlsl('k = 0; k = 3; y = k;');
    expect(undeclared).toContain('k = 0;');
    expect(undeclared).toContain('k = 3;');
  });

  test('declarations truncate or splat like HLSL', () => {
    expect(
      normalizeHlslToGlsl('float corr = texsize.xy * texsize.zw;'),
    ).toMatch(/float corr = milkdropScalar\(/u);
    expect(
      normalizeHlslToGlsl('float3 noise = tex2D(sampler_noise_lq, uv) + 1;'),
    ).toMatch(/vec3 noise = vec3\(/u);
  });

  test('the reserved word output is renamed', () => {
    expect(
      normalizeHlslToGlsl('float3 output = ret; ret = output;'),
    ).not.toMatch(/\boutput\b/u);
  });

  test('array declarations above shader_body survive', () => {
    const body = extractNativeShaderBody(
      'float2 ofs[4]; shader_body { ofs[0] = uv; ret = ofs[0].xxy; }',
    );
    expect(body).toContain('vec2 ofs[4];');
  });
});
