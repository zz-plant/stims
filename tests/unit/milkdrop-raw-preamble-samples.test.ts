import { describe, expect, test } from 'bun:test';
import { normalizeHlslToGlsl } from '../../src/js/milkdrop/compiler/shader-analysis.ts';

/**
 * MilkDrop 2's preamble ships GetPixel/GetBlur0..3, so raw hlsl2glsl bodies
 * call them undeclared. The statement emitter already expanded them; the
 * raw normaliser now does the same, including nested arguments.
 */
describe('raw shader preamble samples', () => {
  test('GetPixel and GetBlurN expand to the emitter forms', () => {
    const glsl = normalizeHlslToGlsl('ret = GetPixel(uv) + GetBlur2(uv);');
    expect(glsl).not.toMatch(/GetPixel|GetBlur/u);
    expect(glsl).toContain(
      'texture2D(currentTex, sampleUv(uv, textureWrap)).xyz',
    );
    expect(glsl).toContain(
      '(texture2D(blur2Tex, sampleUv(uv, textureWrap)).xyz * scale2 + bias2)',
    );
  });

  test('a nested call argument survives intact', () => {
    const glsl = normalizeHlslToGlsl(
      'ret = GetBlur1(fract(uv * float2(2, 3)));',
    );
    // Integer literals become float literals on the raw path (GLSL ES has
    // no implicit int→float conversion).
    expect(glsl).toContain('sampleUv(fract(uv * vec2(2.0, 3.0)), textureWrap)');
  });
});
