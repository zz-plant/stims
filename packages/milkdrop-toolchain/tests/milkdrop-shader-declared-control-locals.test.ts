import { describe, expect, test } from 'bun:test';
import {
  clearShaderAnalysisCaches,
  extractShaderControls,
} from '../src/compiler/shader-analysis.ts';
import {
  generateGlslFromShaderStatements,
  injectDirectShaderGlsl,
} from '../src/compiler/shader-analysis-glsl.ts';

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

  // .milk shaders reach the analyzer with shader_body already stripped, and
  // authors often declare above it and assign below: `float3 dx, dy;` …
  // `dx = GetBlur1(…) - GetBlur1(…)`. The bare declaration is not a
  // statement, so it has to mark the names as locals (and keep their width)
  // on its own.
  test('split declarations above the body keep their names and widths', () => {
    clearShaderAnalysisCaches();
    const analysis = extractShaderControls(
      [
        'float2 d, fraction;',
        'float3 dx, dy;',
        'd = texsize.zw*4;',
        'dx = GetBlur1(uv + float2(1,0)*d) - GetBlur1(uv - float2(1,0)*d);',
        'dy = GetBlur1(uv + float2(0,1)*d) - GetBlur1(uv - float2(0,1)*d);',
        'fraction = float2(dx.x, dy.x)/(d.x + d.y);',
        'ret = fraction.xyx;',
      ].join('\n'),
    );
    const targets = analysis.directProgramStatements.map((s) => s.target);
    expect(targets).toContain('dx');
    expect(targets).toContain('dy');
    const glsl =
      generateGlslFromShaderStatements(
        analysis.directProgramStatements,
        'comp',
      ) ?? '';
    // Seeded with the declared type, which the scratch hoister declares
    // from; every later write is then converted to that width.
    expect(glsl).toContain('dx = vec3(0.0, 0.0, 0.0);');
    expect(glsl).toContain('fraction = vec2(0.0, 0.0);');
    expect(glsl).toContain('fraction = vec2(milkdropDiv(');
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
