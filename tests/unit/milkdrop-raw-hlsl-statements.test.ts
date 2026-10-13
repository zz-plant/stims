import { describe, expect, test } from 'bun:test';
import {
  extractNativeShaderBody,
  finishRawGlslForWebGl,
  normalizeHlslToGlsl,
} from 'milkdrop-toolchain/src/compiler/shader-analysis.ts';

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

/**
 * The WebGL-only finishing pass (finishRawGlslForWebGl): HLSL intrinsics
 * GLSL ES lacks, and HLSL's implicit broadcast/truncation on assignment.
 */
describe('raw HLSL body finishing for WebGL', () => {
  const finish = (shader: string) =>
    finishRawGlslForWebGl(extractNativeShaderBody(shader) ?? '');

  test('saturate, frac, lerp, atan2 and dot become GLSL', () => {
    const glsl = finish(
      'shader_body { float m = saturate (8.0 - rad*(1+q1)); float2 f = frac(uv*2); ret = lerp(ret, 1, m); float a = atan2(uv.y, uv.x); float d = dot(ret, uv); }',
    );
    expect(glsl).toContain('clamp(8.0 - rad*(1.0+q1), 0.0, 1.0)');
    expect(glsl).toContain('fract(uv*2.0)');
    expect(glsl).toContain('milkdropLerp(ret, 1.0, m)');
    expect(glsl).toContain('atan(uv.y, uv.x)');
    expect(glsl).toContain('milkdropDot(ret, uv)');
    expect(glsl).not.toMatch(/\b(?:saturate|frac|lerp|atan2|dot)\s*\(/u);
  });

  test('the shared normaliser leaves the intrinsics for the WebGPU parser', () => {
    // Its executor implements lerp/saturate/frac itself and has no
    // milkdrop* overload sets.
    expect(normalizeHlslToGlsl('ret = lerp(ret, 1, saturate(q1));')).toContain(
      'lerp(ret, 1.0, saturate(q1))',
    );
  });

  test('assignments convert to the declared type, as HLSL does', () => {
    const glsl = finish(
      [
        'float3 color, mus;',
        'float2 rs;',
        'float k;',
        'shader_body {',
        'mus = .2/(sqrt(uv.x)+.2);',
        'mus *= .9+.1*tex2D(sampler_noise_lq, uv);',
        'rs = tex2D(sampler_noise_lq, uv);',
        'k = ret;',
        'ret.xy = q1;',
        '}',
      ].join('\n'),
    );
    expect(glsl).toContain('vec3 color, mus;');
    expect(glsl).toContain('mus = vec3(.2/(sqrt(uv.x)+.2))');
    expect(glsl).toContain('mus *= vec3(.9+.1*texture2D(noiseTex, uv))');
    expect(glsl).toContain('rs = vec2(texture2D(noiseTex, uv))');
    expect(glsl).toContain('k = milkdropScalar(ret)');
    expect(glsl).toContain('ret.xy = vec2(q1)');
  });

  test('a whole matrix on the right-hand side is left alone', () => {
    const glsl = finish(
      'float2x2 m = float2x2(q1, q2, q3, q4); shader_body { uv *= m; uv += m[0]; }',
    );
    expect(glsl).toContain('uv *= m;');
    expect(glsl).toContain('uv += vec2(m[0])');
  });

  test('static globals above shader_body become plain locals', () => {
    const body = extractNativeShaderBody(
      'static const float3 cam = float3(q28, q27, -.07); static float2x2 ofs = float2x2(texsize.z, 0, 0, texsize.w)*4; shader_body { ret = cam + ofs[0].xxy; }',
    );
    expect(body).toMatch(/^\s*vec3 cam = /mu);
    expect(body).toMatch(/^\s*mat2 ofs = /mu);
    expect(body).not.toMatch(/\b(?:static|const)\b/u);
  });

  test('names the body declares again are dropped from the hoisted list', () => {
    // HLSL lets the body's local shadow the global; in one GLSL scope the
    // second declaration is a redefinition.
    const body = extractNativeShaderBody(
      'float2 zz, uv1, uv2; float2 uv3; shader_body { float2 uv1 = uv - 0.5; vec2 uv3 = uv1; zz = uv1 + uv2; }',
    );
    expect(body).toContain('vec2 zz, uv2;');
    expect(body).not.toMatch(/^\s*vec2 uv3;/mu);
    expect(body?.match(/vec2 uv1\b/gu)).toHaveLength(1);
  });
});
