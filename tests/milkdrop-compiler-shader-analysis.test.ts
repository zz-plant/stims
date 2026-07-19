import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildShaderProgramPayload,
  extractShaderControls,
} from '../assets/js/milkdrop/compiler/shader-analysis.ts';
import { generateGlslFromShaderStatements } from '../assets/js/milkdrop/compiler/shader-analysis-glsl.ts';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import { parseMilkdropShaderStatement } from '../assets/js/milkdrop/shader-ast.ts';

const legacySupportedFeedbackFixture = readFileSync(
  join(
    import.meta.dir,
    'fixtures/milkdrop/legacy/legacy-supported-feedback-subset.milk',
  ),
  'utf8',
);

const legacyUnsupportedShaderFixture = readFileSync(
  join(
    import.meta.dir,
    'fixtures/milkdrop/legacy/legacy-unsupported-full-shader-code.milk',
  ),
  'utf8',
);

const projectmNoiseVolumeFixture = readFileSync(
  join(
    import.meta.dir,
    'fixtures/milkdrop/projectm-upstream/261-compshader-noisevol_lq.milk',
  ),
  'utf8',
);

describe('milkdrop compiler shader analysis', () => {
  test('keeps shared scalar control aliases aligned across extraction paths', () => {
    const analysis = extractShaderControls(
      `
rot = 0.25
scale = 1.2
feedback_alpha = 0.35
red = 0.8
green = 0.6
blue = 0.4
texture_amount = 0.5
texture_source = noise
warp_texture_amount = 0.12
warp_texture_scale = vec2(1.1, 1.2)
    `.trim(),
    );

    expect(analysis.supported).toBe(true);
    expect(analysis.unsupportedLines).toEqual([]);
    expect(analysis.controls.rotation).toBeCloseTo(0.25, 6);
    expect(analysis.controls.zoom).toBeCloseTo(1.2, 6);
    expect(analysis.controls.mixAlpha).toBeCloseTo(0.35, 6);
    expect(analysis.controls.colorScale).toMatchObject({
      r: 0.8,
      g: 0.6,
      b: 0.4,
    });
    expect(analysis.controls.textureLayer).toMatchObject({
      source: 'noise',
      amount: 0.5,
    });
    expect(analysis.controls.warpTexture).toMatchObject({
      amount: 0.12,
      scaleX: 1.1,
      scaleY: 1.2,
    });
  });

  test('splats scalar texture transforms across both axes', () => {
    const analysis = extractShaderControls(
      `
texture_offset = 0.25
texture_scale = 1.1
warp_texture_offset += -0.1
warp_texture_scale = bass_att * 0.5
      `.trim(),
      { bass_att: 0.4 },
    );

    expect(analysis.supported).toBe(true);
    expect(analysis.unsupportedLines).toEqual([]);
    expect(analysis.controls.textureLayer).toMatchObject({
      offsetX: 0.25,
      offsetY: 0.25,
      scaleX: 1.1,
      scaleY: 1.1,
    });
    expect(analysis.controls.warpTexture).toMatchObject({
      offsetX: -0.1,
      offsetY: -0.1,
      scaleX: 0.2,
      scaleY: 0.2,
    });
  });

  test('extracts supported shader controls from the legacy feedback fixture', () => {
    const compiled = compileMilkdropPresetSource(
      legacySupportedFeedbackFixture,
      {
        id: 'legacy-supported-feedback-subset',
      },
    );

    const warpAnalysis = extractShaderControls(compiled.ir.shaderText.warp);
    const compAnalysis = extractShaderControls(compiled.ir.shaderText.comp);

    expect(warpAnalysis.supported).toBe(true);
    expect(warpAnalysis.unsupportedLines).toEqual([]);
    expect(warpAnalysis.controls.warpScale).toBeCloseTo(0.65, 6);
    expect(warpAnalysis.controls.offsetX).toBeCloseTo(0.03, 6);
    expect(warpAnalysis.controls.offsetY).toBeCloseTo(-0.02, 6);

    expect(compAnalysis.supported).toBe(true);
    expect(compAnalysis.controls.mixAlpha).toBeCloseTo(0.24, 6);
    expect(compAnalysis.controls.tint).toMatchObject({
      r: 1,
      g: 0.7,
      b: 0.5,
    });
    expect(compAnalysis.controls.saturation).toBeCloseTo(1.2, 6);
    expect(compAnalysis.controls.contrast).toBeCloseTo(1.08, 6);
  });

  test('builds direct shader payloads from parsed shader statements', () => {
    const compiled = compileMilkdropPresetSource(
      legacyUnsupportedShaderFixture,
      {
        id: 'legacy-unsupported-full-shader-code',
      },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.shaderText.unsupportedLines).toEqual([]);

    const statement = parseMilkdropShaderStatement(
      'ret=tex2d(sampler_main,uv).rgb*gain',
    );
    expect(statement).not.toBeNull();
    if (!statement) {
      throw new Error('Expected direct shader statement to parse');
    }
    const payload = buildShaderProgramPayload({
      stage: 'comp',
      statements: [statement],
      normalizedLines: ['ret=tex2d(sampler_main,uv).rgb*gain'],
      requiresControlFallback: true,
      supportedBackends: ['webgl', 'webgpu'],
    });

    expect(payload.execution.kind).toBe('direct-feedback-program');
    expect(payload.execution.entryTarget).toBe('ret');
    expect(payload.execution.statementTargets).toEqual(['ret']);
    expect(payload.execution.requiresControlFallback).toBe(true);
    expect(payload.source).toBe('ret=tex2d(sampler_main,uv).rgb*gain');
  });

  test('emits known MilkDrop shader operators and signal aliases to valid GLSL', () => {
    const powStatement = parseMilkdropShaderStatement(
      'ret = tex2d(sampler_main, uv).rgb * vec3(bassAtt ^ 2.0, midAtt, trebleAtt)',
    );
    const bitwiseOrStatement = parseMilkdropShaderStatement(
      'gain = bassAtt | 2.0',
    );
    const bitwiseAndStatement = parseMilkdropShaderStatement(
      'mask = midAtt & 1.0',
    );

    expect(powStatement).not.toBeNull();
    expect(bitwiseOrStatement).not.toBeNull();
    expect(bitwiseAndStatement).not.toBeNull();
    if (!powStatement || !bitwiseOrStatement || !bitwiseAndStatement) {
      throw new Error('Expected known MilkDrop shader constructs to parse');
    }

    const glsl = generateGlslFromShaderStatements(
      [powStatement, bitwiseOrStatement, bitwiseAndStatement],
      'comp',
    );

    expect(glsl).not.toBeNull();
    expect(glsl).toContain('pow(signalBass, 2.0)');
    expect(glsl).toContain('signalMid');
    expect(glsl).toContain('signalTreb');
    expect(glsl).toContain('float(int(signalBass) | int(2.0))');
    expect(glsl).toContain('float(int(signalMid) & int(1.0))');
  });

  test('emits tex3D vec3 coordinates with a real z slice in GLSL', () => {
    const twoArgStatement = parseMilkdropShaderStatement(
      'ret = tex3D(sampler_fw_noisevol_lq, vec3(uv, time / 10.0)).xyz',
    );
    const threeArgStatement = parseMilkdropShaderStatement(
      'ret = tex3D(sampler_noisevol_lq, vec3(uv.x, uv.y, time / 5.0)).xyz',
    );
    const noiseStatement = parseMilkdropShaderStatement(
      'ret = tex3D(sampler_noise_lq, vec3(uv, time / 20.0)).xyz',
    );

    expect(twoArgStatement).not.toBeNull();
    expect(threeArgStatement).not.toBeNull();
    expect(noiseStatement).not.toBeNull();
    if (!twoArgStatement || !threeArgStatement || !noiseStatement) {
      throw new Error('Expected tex3D statements to parse');
    }

    const glsl = generateGlslFromShaderStatements(
      [twoArgStatement, threeArgStatement, noiseStatement],
      'comp',
    );

    expect(glsl).not.toBeNull();
    expect(glsl).toContain('sampleUv(vUv, textureWrap), (signalTime / 10.0)');
    expect(glsl).toContain(
      'sampleUv(vec2(vUv.x, vUv.y), textureWrap), (signalTime / 5.0)',
    );
    expect(glsl).toContain('sampleUv(vUv, textureWrap), (signalTime / 20.0)');
    expect(glsl).toContain('sampleAuxTexture(vec4(1.0, 0, 0, 0).x, 1.0');
  });

  test('lowers a mix of the main sample with a scaled main sample', () => {
    const analysis = extractShaderControls(
      'ret = mix(tex2d(sampler_main, uv).rgb, tex2d(sampler_main, uv).rgb * bass_att, 0.5)',
      { bass_att: 0.4 },
    );

    expect(analysis.supported).toBe(false);
    expect(analysis.unsupportedLines).toEqual([]);
    expect(analysis.controls.colorScale).toMatchObject({
      r: 0.7,
      g: 0.7,
      b: 0.7,
    });
    expect(analysis.directProgramRequired).toBe(true);
  });

  test('keeps the volume shader payload direct across native and fallback backends', () => {
    const compiled = compileMilkdropPresetSource(projectmNoiseVolumeFixture, {
      id: '261-compshader-noisevol_lq',
    });

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.shaderText.compProgram).not.toBeNull();
    expect(compiled.ir.shaderText.compProgram?.execution.kind).toBe(
      'direct-feedback-program',
    );
    expect(
      compiled.ir.shaderText.compProgram?.execution.requiresControlFallback,
    ).toBe(true);
    expect(
      compiled.ir.compatibility.featureAnalysis.shaderTextExecution,
    ).toEqual({
      webgl: 'direct',
      webgpu: 'direct',
    });
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
    expect(compiled.ir.compatibility.backends.webgpu.status).toBe('supported');
    expect(compiled.ir.compatibility.featureAnalysis.featuresUsed).toContain(
      'volume-textures',
    );
    expect(compiled.ir.compatibility.gpuDescriptorPlans.webgpu.routing).toBe(
      'fallback-webgl',
    );
    expect(compiled.ir.compatibility.parity.fidelityClass).toBe('exact');
  });
});

test('keeps native shader-body aspect as a runtime uniform', () => {
  const compiled = compileMilkdropPresetSource(
    `[preset00]\nwarp_shader=float x = aspect; shader_body { ret = tex2D(sampler_main, uv); }`,
    {},
    { aspect: 16 / 9 },
  );

  expect(
    compiled.ir.shaderText.warpProgram?.normalizedLines.join(' '),
  ).toContain('float x = aspect');
});
