import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import {
  evaluateMilkdropShaderExpression,
  parseMilkdropShaderStatement,
} from '../assets/js/milkdrop/shader-ast.ts';
import {
  isMilkdropVolumeShaderSamplerName as isVolumeSamplerName,
  normalizeMilkdropShaderSamplerName,
} from '../assets/js/milkdrop/shader-samplers.ts';

const SAMPLER_ALIAS_CASES = [
  {
    alias: 'sampler_fw_noise_lq',
    canonical: 'noise',
  },
  {
    alias: 'fw_noise_hq',
    canonical: 'noise',
  },
  {
    alias: 'sampler_noisevol',
    canonical: 'simplex',
  },
  {
    alias: 'sampler_fw_noisevol_lq',
    canonical: 'simplex',
  },
] as const;

describe('milkdrop shader sampler aliases', () => {
  test('normalizes MilkDrop2 vector aliases and 3D sampler calls in shader ASTs', () => {
    const tintStatement = parseMilkdropShaderStatement(
      'float3 tint = float3(1.0, 0.5, 0.25)',
    );
    expect(tintStatement).not.toBeNull();
    if (!tintStatement) {
      throw new Error('Failed to parse float3 tint statement');
    }

    expect(tintStatement.declaration).toBe('vec3');
    expect(tintStatement.expression).toMatchObject({
      type: 'call',
      name: 'vec3',
    });

    const volumeStatement = parseMilkdropShaderStatement(
      'ret = texture3D(sampler_fw_noisevol_lq, float3(uv, time / 10.0)).xyz',
    );
    expect(volumeStatement).not.toBeNull();
    if (!volumeStatement) {
      throw new Error('Failed to parse texture3D volume sample');
    }

    expect(volumeStatement.expression).toMatchObject({
      type: 'member',
      property: 'xyz',
      object: {
        type: 'call',
        name: 'tex3d',
      },
    });

    const astValue = evaluateMilkdropShaderExpression(
      volumeStatement.expression,
      { uv: { kind: 'vec2', value: [0.25, 0.75] } },
      { time: 2 },
    );
    expect(astValue).toMatchObject({
      kind: 'vec3',
      value: [1, 1, 1],
    });

    const callValue = evaluateMilkdropShaderExpression(
      volumeStatement.expression.type === 'member'
        ? volumeStatement.expression.object
        : volumeStatement.expression,
      { uv: { kind: 'vec2', value: [0.25, 0.75] } },
      { time: 2 },
    );
    expect(callValue).toMatchObject({
      kind: 'sample',
      source: 'simplex',
      dimension: '3d',
      z: {
        kind: 'scalar',
        value: 0.2,
      },
    });
  });

  test('normalizes supported aliases through the shared helper', () => {
    for (const { alias, canonical } of SAMPLER_ALIAS_CASES) {
      expect(normalizeMilkdropShaderSamplerName(alias)).toBe(canonical);
    }

    expect(normalizeMilkdropShaderSamplerName('sampler_unknown_alias')).toBe(
      null,
    );
  });

  test('identifies atlas-backed aux samplers as runtime volume samplers', () => {
    expect(isVolumeSamplerName('simplex')).toBe(true);
    expect(isVolumeSamplerName('noise')).toBe(true);
    expect(isVolumeSamplerName('voronoi')).toBe(true);
  });

  test('keeps AST shader sampling aligned with compiler shader extraction', () => {
    for (const { alias, canonical } of SAMPLER_ALIAS_CASES) {
      const astStatement = parseMilkdropShaderStatement(
        `ret = tex2d(${alias}, uv)`,
      );
      expect(astStatement).not.toBeNull();
      if (!astStatement) {
        throw new Error(`Failed to parse shader statement for ${alias}`);
      }
      const astValue = evaluateMilkdropShaderExpression(
        astStatement.expression,
        { uv: { kind: 'vec2', value: [0.25, 0.75] } },
        {},
      );

      expect(astValue).toMatchObject({
        kind: 'sample',
        source: canonical,
      });

      const sampledCompile = compileMilkdropPresetSource(
        `title=Alias Sample\ncomp_shader=ret = tex2d(${alias}, uv).rgb`,
        { id: `sample-${alias}` },
      );
      expect(sampledCompile.ir.shaderText.supported).toBe(true);
      expect(sampledCompile.ir.post.shaderControls.textureLayer.source).toBe(
        canonical,
      );
      expect(sampledCompile.ir.post.shaderControls.textureLayer.mode).toBe(
        'replace',
      );

      const assignedCompile = compileMilkdropPresetSource(
        `title=Alias Control\ncomp_shader=texture_source = ${alias}`,
        { id: `control-${alias}` },
      );
      expect(assignedCompile.ir.shaderText.supported).toBe(true);
      expect(assignedCompile.ir.post.shaderControls.textureLayer.source).toBe(
        canonical,
      );
      expect(assignedCompile.ir.post.shaderControls.textureLayer.mode).toBe(
        'mix',
      );
    }
  });

  test('keeps 3D sampler aliases aligned in compiler extraction', () => {
    for (const sampleCall of ['tex3D', 'texture3D'] as const) {
      const compiled = compileMilkdropPresetSource(
        `title=Volume Alias\ncomp_shader=ret = ${sampleCall}(sampler_fw_noisevol_lq, float3(uv, time / 10.0)).xyz`,
        { id: `volume-${sampleCall.toLowerCase()}` },
      );

      expect(compiled.ir.shaderText.supported).toBe(true);
      expect(compiled.ir.shaderText.unsupportedLines).toEqual([]);
      expect(compiled.ir.post.shaderControls.textureLayer.source).toBe(
        'simplex',
      );
      expect(compiled.ir.post.shaderControls.textureLayer.mode).toBe('replace');
      expect(compiled.ir.post.shaderControls.textureLayer.sampleDimension).toBe(
        '3d',
      );
      expect(
        compiled.ir.post.shaderControls.textureLayer.volumeSliceZ,
      ).toBeCloseTo(0, 6);
      expect(
        compiled.ir.post.shaderControlExpressions.textureLayer.volumeSliceZ,
      ).not.toBeNull();
      expect(compiled.diagnostics).toEqual([]);
      expect(compiled.ir.compatibility.warnings).toEqual([]);
      expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
      expect(compiled.ir.compatibility.backends.webgpu.status).toBe(
        'supported',
      );
    }
  });
});
