import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import {
  evaluateMilkdropShaderExpression,
  parseMilkdropShaderStatement,
} from '../assets/js/milkdrop/shader-ast.ts';
import {
  classifyTex3dSamplerEquivalence,
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

const SAMPLER_CANONICAL_CASES = [
  {
    alias: 'sampler_perlin',
    canonical: 'perlin',
  },
  {
    alias: 'sampler_aura',
    canonical: 'aura',
  },
  {
    alias: 'sampler_caustics',
    canonical: 'caustics',
  },
  {
    alias: 'sampler_pattern',
    canonical: 'pattern',
  },
  {
    alias: 'sampler_voronoi',
    canonical: 'voronoi',
  },
  {
    alias: 'sampler_fractal',
    canonical: 'fractal',
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

    expect(normalizeMilkdropShaderSamplerName('sampler_video')).toBe('video');
    expect(normalizeMilkdropShaderSamplerName('sampler_noise')).toBe('noise');
    expect(normalizeMilkdropShaderSamplerName('sampler_fw_noise')).toBe(
      'noise',
    );
    expect(normalizeMilkdropShaderSamplerName('sampler_fw_noise_mq')).toBe(
      'noise',
    );
    expect(normalizeMilkdropShaderSamplerName('sampler_unknown_alias')).toBe(
      null,
    );
  });

  test('normalizes canonical sampler names through the shared helper', () => {
    for (const { alias, canonical } of SAMPLER_CANONICAL_CASES) {
      expect(normalizeMilkdropShaderSamplerName(alias)).toBe(canonical);
    }
  });

  test('normalizes perlin as a distinct sampler with correct compiler extraction', () => {
    expect(normalizeMilkdropShaderSamplerName('sampler_perlin')).toBe('perlin');

    const sampledCompile = compileMilkdropPresetSource(
      `title=Perlin Sample\ncomp_shader=ret = tex2d(sampler_perlin, uv).rgb`,
      { id: 'sample-perlin' },
    );
    expect(sampledCompile.ir.shaderText.supported).toBe(true);
    expect(sampledCompile.ir.post.shaderControls.textureLayer.source).toBe(
      'perlin',
    );
    expect(sampledCompile.ir.post.shaderControls.textureLayer.mode).toBe(
      'replace',
    );

    const assignedCompile = compileMilkdropPresetSource(
      `title=Perlin Control\ncomp_shader=texture_source = sampler_perlin`,
      { id: 'control-perlin' },
    );
    expect(assignedCompile.ir.shaderText.supported).toBe(true);
    expect(assignedCompile.ir.post.shaderControls.textureLayer.source).toBe(
      'perlin',
    );
  });

  test('maps perlin to its own source ID distinct from noise', () => {
    const noiseCompile = compileMilkdropPresetSource(
      `title=Noise Sample\ncomp_shader=ret = tex2d(sampler_noise, uv).rgb`,
      { id: 'sample-noise' },
    );
    const perlinCompile = compileMilkdropPresetSource(
      `title=Perlin Sample\ncomp_shader=ret = tex2d(sampler_perlin, uv).rgb`,
      { id: 'sample-perlin' },
    );

    expect(noiseCompile.ir.post.shaderControls.textureLayer.source).toBe(
      'noise',
    );
    expect(perlinCompile.ir.post.shaderControls.textureLayer.source).toBe(
      'perlin',
    );
    expect(
      noiseCompile.ir.compatibility.featureAnalysis.shaderTextExecution,
    ).toEqual({ webgl: 'direct', webgpu: 'direct' });
    expect(
      perlinCompile.ir.compatibility.featureAnalysis.shaderTextExecution,
    ).toEqual({ webgl: 'direct', webgpu: 'direct' });
  });

  test('keeps direct shader execution with sampler aliases and GLSL-only constructs', () => {
    const compiled = compileMilkdropPresetSource(
      `title=Alias Construct Sample
comp_shader=ret = tex2d(sampler_perlin, uv).rgb * vec3(bassAtt ^ 2.0, midAtt | 2.0, trebleAtt & 1.0)`,
      { id: 'alias-construct-sample' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.shaderText.unsupportedLines).toEqual([]);
    expect(compiled.ir.shaderText.compProgram).toEqual(
      expect.objectContaining({
        source:
          'ret = tex2d(sampler_perlin, uv).rgb * vec3(bassAtt ^ 2.0, midAtt | 2.0, trebleAtt & 1.0)',
        execution: expect.objectContaining({
          kind: 'direct-feedback-program',
          supportedBackends: ['webgl', 'webgpu'],
        }),
      }),
    );
    expect(
      compiled.ir.compatibility.featureAnalysis.shaderTextExecution,
    ).toEqual({ webgl: 'direct', webgpu: 'direct' });
  });

  test('identifies all aux samplers as runtime volume samplers', () => {
    expect(isVolumeSamplerName('simplex')).toBe(true);
    expect(isVolumeSamplerName('noise')).toBe(true);
    expect(isVolumeSamplerName('perlin')).toBe(true);
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
      expect(compiled.diagnostics).toEqual([
        {
          severity: 'warning',
          code: 'preset_shader_volume_approximation',
          message: expect.stringContaining('volume sampler'),
        },
      ]);
      expect(compiled.ir.compatibility.warnings).toEqual([
        expect.stringContaining('no true browser equivalent'),
      ]);
      expect(compiled.ir.compatibility.backends.webgl.status).toBe('partial');
      expect(compiled.ir.compatibility.backends.webgpu.status).toBe('partial');
    }
  });

  test('classifies tex3D volume sampler usage as not-equivalent with measured diagnostic coverage', () => {
    expect(classifyTex3dSamplerEquivalence('3d', 'simplex')).toBe(
      'not-equivalent',
    );
    expect(classifyTex3dSamplerEquivalence('2d', 'simplex')).toBe(
      'semantic-supported',
    );
    expect(classifyTex3dSamplerEquivalence('3d', 'noise')).toBe(
      'not-equivalent',
    );
    expect(classifyTex3dSamplerEquivalence('3d', 'main')).toBe(
      'semantic-supported',
    );
    expect(classifyTex3dSamplerEquivalence(null, 'simplex')).toBe(
      'semantic-supported',
    );

    const compiled = compileMilkdropPresetSource(
      `title=Volume Classification
comp_shader=ret = tex3D(sampler_fw_noisevol_lq, float3(uv, time / 10.0)).xyz`,
      { id: 'volume-classification' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.post.shaderControls.textureLayer.source).toBe('simplex');
    expect(compiled.ir.post.shaderControls.textureLayer.sampleDimension).toBe(
      '3d',
    );
    expect(compiled.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'preset_shader_volume_approximation',
        message: expect.stringContaining('volume sampler'),
      },
    ]);
    const volumeDiag = compiled.diagnostics.find(
      (d) => d.code === 'preset_shader_volume_approximation',
    );
    expect(volumeDiag).not.toBeUndefined();
    expect(volumeDiag?.message).toContain('no true browser equivalent');
  });
});
