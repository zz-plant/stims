import { describe, expect, test } from 'bun:test';
import { Texture } from 'three';
import { compileShaderExpressionNode } from '../../src/js/milkdrop/feedback-manager-webgpu.ts';
import {
  createCompositeUniforms,
  createSampleAuxTextureNode,
  createSampleUvNode,
} from '../../src/js/milkdrop/feedback-manager-webgpu-composite.ts';
import { parseMilkdropShaderStatement } from '../../src/js/milkdrop/shader-ast.ts';

function buildShaderEnv() {
  const aux = {
    noise: new Texture(),
    perlin: new Texture(),
    simplex: new Texture(),
    voronoi: new Texture(),
    aura: new Texture(),
    caustics: new Texture(),
    pattern: new Texture(),
    fractal: new Texture(),
    video: new Texture(),
  };
  const uniforms = createCompositeUniforms(new Texture(), new Texture(), aux);
  const sampleUvNode = createSampleUvNode();
  const sampleAuxTextureNode = createSampleAuxTextureNode(
    uniforms.noiseTex,
    uniforms.perlinTex,
    uniforms.simplexTex,
    uniforms.voronoiTex,
    uniforms.auraTex,
    uniforms.causticsTex,
    uniforms.patternTex,
    uniforms.fractalTex,
    uniforms.videoTex,
    uniforms.glyphTex,
    uniforms.organicTex,
    uniforms.noiseLqTex,
    uniforms.noisevolTex,
    uniforms.blur1Tex,
    uniforms.blur2Tex,
    uniforms.blur3Tex,
    {
      noise: uniforms.noiseTex3D,
      simplex: uniforms.simplexTex3D,
      voronoi: uniforms.voronoiTex3D,
      aura: uniforms.auraTex3D,
      caustics: uniforms.causticsTex3D,
      pattern: uniforms.patternTex3D,
      fractal: uniforms.fractalTex3D,
      perlin: uniforms.perlinTex3D,
      noisevol: uniforms.noisevolTex3D,
    },
  );
  return {
    values: new Map<string, { kind: 'vec2'; node: unknown }>([
      ['uv', { kind: 'vec2', node: { x: 0, y: 0 } }],
    ]),
    uniforms,
    sampleUvNode,
    sampleAuxTextureNode,
  } as const;
}

function compileExpression(source: string) {
  const statement = parseMilkdropShaderStatement(source);
  if (!statement) {
    throw new Error(`Failed to parse: ${source}`);
  }
  return compileShaderExpressionNode(statement.expression, buildShaderEnv());
}

describe('milkdrop WebGPU TSL extended intrinsics', () => {
  test('builds nodes for the extended math intrinsics', () => {
    for (const source of [
      'x = tan(0.5)',
      'x = ceil(0.5)',
      'x = sign(-0.5)',
      'x = exp(0.5)',
      'x = exp2(0.5)',
      'x = log(0.5)',
      'x = log2(0.5)',
      'x = rsqrt(0.5)',
      'x = trunc(0.5)',
      'x = round(0.5)',
      'x = fwidth(0.5)',
      'x = ddx(0.5)',
      'x = ddy(0.5)',
      'x = asin(0.5)',
      'x = acos(0.5)',
      'x = atan(0.5)',
      'x = atan2(0.5, 0.5)',
      'x = saturate(0.5)',
      'x = float(0.5)',
      'x = int(0.5)',
      'x = bool(0.5)',
      'x = half(0.5)',
    ]) {
      const value = compileExpression(source);
      expect(value, source).not.toBeNull();
      expect(value?.kind, source).toBe('scalar');
    }
  });

  test('builds nodes for vector math intrinsics', () => {
    const normalizeValue = compileExpression(
      'x = normalize(vec3(0.0, 1.0, 0.0))',
    );
    expect(normalizeValue?.kind).toBe('vec3');

    const crossValue = compileExpression(
      'x = cross(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0))',
    );
    expect(crossValue?.kind).toBe('vec3');

    const reflectValue = compileExpression(
      'x = reflect(vec3(0.0, -1.0, 0.0), vec3(0.0, 1.0, 0.0))',
    );
    expect(reflectValue?.kind).toBe('vec3');

    const refractValue = compileExpression(
      'x = refract(vec3(0.0, -1.0, 0.0), vec3(0.0, 1.0, 0.0), 1.0)',
    );
    expect(refractValue?.kind).toBe('vec3');
  });

  test('builds a vec3 node for sampleNoiseVolume volume sampling', () => {
    const value = compileExpression(
      'x = sampleNoiseVolume(vec3(0.1, 0.2, 0.3))',
    );
    expect(value).not.toBeNull();
    expect(value?.kind).toBe('vec3');
  });

  test('builds tex2Dlod/tex2Dbias/tex2Dgrad nodes against direct textures', () => {
    const lod = compileExpression(
      'x = tex2Dlod(sampler_main, vec4(0.5, 0.5, 0.0, 2.0))',
    );
    expect(lod?.kind).toBe('vec3');

    const bias = compileExpression(
      'x = tex2Dbias(sampler_noise, vec4(0.5, 0.5, 0.0, 0.5))',
    );
    expect(bias?.kind).toBe('vec3');

    const grad = compileExpression(
      'x = tex2Dgrad(sampler_main, uv, vec2(0.1, 0.0), vec2(0.0, 0.1))',
    );
    expect(grad?.kind).toBe('vec3');
  });

  test('resolves rewritten texture identifiers to canonical sampler bindings', () => {
    const current = compileExpression('x = tex2d(currentTex, uv)');
    expect(current?.kind).toBe('vec3');

    const blur = compileExpression('x = tex2d(blur1Tex, uv)');
    expect(blur?.kind).toBe('vec3');

    const warp = compileExpression('x = tex2d(warpTex, uv)');
    expect(warp?.kind).toBe('vec3');

    const simplex = compileExpression('x = tex2d(simplexTex, uv)');
    expect(simplex?.kind).toBe('vec3');
  });

  test('still rejects unknown calls instead of silently building', () => {
    expect(compileExpression('x = unknownIntrinsic(1.0)')).toBeNull();
  });
});
