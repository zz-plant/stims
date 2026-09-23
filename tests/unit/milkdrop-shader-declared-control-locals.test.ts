import { describe, expect, test } from 'bun:test';
import {
  clearShaderAnalysisCaches,
  extractShaderControls,
} from '../../src/js/milkdrop/compiler/shader-analysis.ts';
import {
  generateGlslFromShaderStatements,
  injectDirectShaderGlsl,
} from '../../src/js/milkdrop/compiler/shader-analysis-glsl.ts';

/**
 * `dx`, `dy`, `zoom`, `rot` and `r/g/b` are per-frame control names, and
 * the analyzer consumes assignments to them as control writes. A body that
 * declares one as its own local — `float3 dx = GetPixel(…) - GetPixel(…)`,
 * the edge-detect idiom in ~70 cotc presets — lost the declaration from
 * the direct program, and every later `dx.y` read the scalar offsetX
 * uniform: a "scalar swizzle" compile error on WebGL.
 */
describe('declared locals named like per-frame controls', () => {
  const body = (text: string) => `shader_body {\n${text}\n}`;

  test('stay in the direct program and are read as locals', () => {
    clearShaderAnalysisCaches();
    const analysis = extractShaderControls(
      body(
        [
          'float2 d = texsize.zw;',
          'float3 dx = GetPixel(uv + float2(1,0)*d) - GetPixel(uv - float2(1,0)*d);',
          'float3 dy = GetPixel(uv + float2(0,1)*d) - GetPixel(uv - float2(0,1)*d);',
          'float2 dz = float2(dx.y, dy.y);',
          'ret = dz.xxy;',
        ].join('\n'),
      ),
    );
    const targets = analysis.directProgramStatements.map((s) => s.target);
    expect(targets).toContain('dx');
    expect(targets).toContain('dy');
    const glsl =
      generateGlslFromShaderStatements(
        analysis.directProgramStatements,
        'comp',
      ) ?? '';
    expect(glsl).toContain('vec3 dx =');
    expect(glsl).toContain('vec2(dx.y, dy.y)');
    expect(glsl).not.toContain('offsetX');
  });

  test('an undeclared control name still drives the control', () => {
    clearShaderAnalysisCaches();
    const analysis = extractShaderControls(
      body('zoom = 1.1;\nret = tex2D(sampler_main, uv).xyz;'),
    );
    expect(analysis.controls.zoom).toBeCloseTo(1.1, 6);
  });
});

/**
 * The body is injected inline in the template's main(), and the template
 * keeps running after it. Unscoped, a preset's `vec2 zoom` shadowed the
 * template's `zoom` uniform in `signedZoomDivisor(zoom)` below it.
 */
describe('injected shader body scope', () => {
  test('preset locals cannot shadow template names after the body', () => {
    const template = [
      'uniform float zoom;',
      'void main() {',
      '// --- DIRECT_WARP_START ---',
      '// --- DIRECT_WARP_END ---',
      '  float z = zoom;',
      '}',
    ].join('\n');
    const out = injectDirectShaderGlsl(
      template,
      '  vec2 zoom = vec2(1.85);\n  ret = vec3(zoom.x);',
      null,
    );
    const start = out.indexOf('// --- DIRECT_WARP_START ---');
    const end = out.indexOf('// --- DIRECT_WARP_END ---');
    const injected = out.slice(start, end);
    expect(injected.trim().split('\n')[1]).toBe('{');
    expect(injected.trimEnd().endsWith('}')).toBe(true);
  });
});
