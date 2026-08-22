import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildShaderProgramPayload,
  clearShaderAnalysisCaches,
  extractNativeShaderBody,
  extractShaderControls,
  normalizeHlslToGlsl,
  splitShaderGlobalsAndBody,
} from '../../src/js/milkdrop/compiler/shader-analysis.ts';
import { generateGlslFromShaderStatements } from '../../src/js/milkdrop/compiler/shader-analysis-glsl.ts';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { parseMilkdropShaderStatement } from '../../src/js/milkdrop/shader-ast.ts';

const legacySupportedFeedbackFixture = readFileSync(
  join(
    import.meta.dir,
    '../fixtures/milkdrop/legacy/legacy-supported-feedback-subset.milk',
  ),
  'utf8',
);

const legacyUnsupportedShaderFixture = readFileSync(
  join(
    import.meta.dir,
    '../fixtures/milkdrop/legacy/legacy-unsupported-full-shader-code.milk',
  ),
  'utf8',
);

const projectmNoiseVolumeFixture = readFileSync(
  join(
    import.meta.dir,
    '../fixtures/milkdrop/projectm-upstream/261-compshader-noisevol_lq.milk',
  ),
  'utf8',
);

describe('milkdrop compiler shader analysis', () => {
  // shaderSourcePrepCache and shaderStatementCache are module-level, so a test
  // that leaves entries behind changes what later tests compile. Two tests
  // cleared them inline, which left every other test in the file dependent on
  // execution order — the tex3D lowering assertions below passed alone and
  // failed after the fixture-heavy tests ran first. Reset for all of them.
  beforeEach(() => {
    clearShaderAnalysisCaches();
  });

  test('reuses parsed statements for immutable shader source', () => {
    const source = 'rot = bass * 0.25; zoom = 1.1';

    const first = extractShaderControls(source, { bass: 0.4 });
    const second = extractShaderControls(source, { bass: 0.8 });

    expect(first.statements).toHaveLength(2);
    expect(second.statements).toHaveLength(2);
    expect(second.statements[0]).toBe(first.statements[0]);
    expect(second.statements[1]).toBe(first.statements[1]);
    expect(second.controls.rotation).not.toBe(first.controls.rotation);
  });

  test('does not let consumers corrupt a cached shader statement', () => {
    const source = 'rot = bass * 0.25';

    const first = extractShaderControls(source, { bass: 0.4 });
    const statement = first.statements[0];
    expect(statement).toBeDefined();
    if (!statement) {
      throw new Error('Expected the shader statement to parse.');
    }

    expect(Reflect.set(statement, 'target', 'corrupted')).toBe(false);
    expect(Reflect.set(statement.expression, 'type', 'literal')).toBe(false);

    const second = extractShaderControls(source, { bass: 0.8 });
    expect(second.statements[0]).toBe(statement);
    expect(second.statements[0]?.target).toBe('rot');
    expect(second.statements[0]?.expression.type).toBe('binary');
    expect(second.controls.rotation).toBeCloseTo(0.2, 6);
  });

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
    expect(glsl).toContain('pow(signalBassAtt, 2.0)');
    expect(glsl).toContain('signalMidAtt');
    expect(glsl).toContain('signalTrebAtt');
    expect(glsl).toContain('float(int(signalBassAtt) | int(2.0))');
    expect(glsl).toContain('float(int(signalMidAtt) & int(1.0))');
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

  test('extracts a native shader_body block and drops trailing content after its close', () => {
    const body = extractNativeShaderBody(
      'shader_body { ret = tex2d(sampler_main, uv).rgb; } dx = 0.5;',
    );
    expect(body).toBe('ret = tex2d(currentTex, uv).rgb;');
  });

  test('extracts only the first shader_body block when presets carry several', () => {
    const body = extractNativeShaderBody(
      'shader_body { ret = tex2d(sampler_main, uv).rgb; } shader_body { ret = vec3(1.0); }',
    );
    expect(body).toBe('ret = tex2d(currentTex, uv).rgb;');
    expect(body).not.toContain('vec3(1.0)');
    expect(body).not.toContain('}');
  });

  test('keeps nested if/for braces inside a native shader_body block intact', () => {
    const body = extractNativeShaderBody(
      'shader_body { if (a > 0.5) { ret = tex2d(sampler_main, uv).rgb; } else { ret = vec3(0.0); } }\n// trailing comment',
    );
    expect(body).not.toBeNull();
    expect(body).toContain('if (a > 0.5) { ret = tex2d(currentTex, uv).rgb;');
    expect(body).not.toContain('// trailing comment');
    expect(body?.split('{').length).toBe(body?.split('}').length);
  });

  test('rewrites texture3D volume-noise samples to the atlas-slice helper', () => {
    const normalized = normalizeHlslToGlsl(
      'ret = texture3D(sampler_fw_noisevol_lq, vec3(uv, 0.5)).rgb;',
    );
    expect(normalized).toContain('sampleNoiseVolume( vec3(uv, 0.5)).rgb;');
    expect(normalized).not.toContain('texture3D');
    expect(normalized).not.toContain('simplexTex');
  });

  test('splits typed functions with float2/uint/const returns and nested-paren args into globals', () => {
    const glsl = [
      'float2 scaleBy(vec2 v, float s) { return v * s; }',
      'uint pick(vec2 p) { return uint(p.x); }',
      'const float two() { return 2.0; }',
      'float x = 0.5;',
      'ret = scaleBy(uv, two());',
    ].join('\n');

    const { globals, body } = splitShaderGlobalsAndBody(glsl);
    expect(globals).toContain(
      'float2 scaleBy(vec2 v, float s) { return v * s; }',
    );
    expect(globals).toContain('uint pick(vec2 p) { return uint(p.x); }');
    expect(globals).toContain('const float two() { return 2.0; }');
    expect(body).toContain('float x = 0.5;');
    expect(body).toContain('ret = scaleBy(uv, two());');
    expect(body).not.toContain('{');
  });

  test('leaves bodies without function declarations untouched', () => {
    const glsl = 'float x = 0.5;\nret = tex2d(sampler_main, uv).rgb;';
    const { globals, body } = splitShaderGlobalsAndBody(glsl);
    expect(globals).toBe('');
    expect(body).toBe(glsl);
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

describe('branch flattening for direct shader execution', () => {
  beforeEach(() => {
    clearShaderAnalysisCaches();
  });

  const nativeBody = (body: string) => `shader_body {\n${body}\n}`;

  test('turns an if/else into masked assignments the statement model can run', () => {
    const analysis = extractShaderControls(
      nativeBody(`
        vec3 ret_2;
        ret_2 = texture(sampler_pw_main, uv).xyz;
        if ((uv.x < 0.5)) {
          ret_2 = vec3(1.0, 0.0, 0.0);
        } else {
          ret_2 = vec3(0.0, 1.0, 0.0);
        };
        ret = ret_2;
      `),
    );

    expect(analysis.nativeBodyUnparsedLines).toEqual([]);
    const targets = analysis.directProgramStatements.map(
      (statement) => statement.target,
    );
    // Both branches survive as assignments to the same variable...
    expect(targets.filter((target) => target === 'ret_2')).toHaveLength(3);
    // ...and the else arm is the complement of the then arm, not a second
    // unconditional write.
    const lines = analysis.directProgramLines.join('\n');
    expect(lines).toContain('1.0 - (step(0.0001, abs((uv.x < 0.5))))');
  });

  test('initializes a variable a branch writes before anything else does', () => {
    const analysis = extractShaderControls(
      nativeBody(`
        vec3 ret_2;
        bool hit_1;
        ret_2 = texture(sampler_pw_main, uv).xyz;
        if ((uv.y < 0.5)) {
          hit_1 = (uv.x < 0.5);
        } else {
          hit_1 = bool(0);
        };
        ret = ret_2;
      `),
    );

    // Without the seed the masked assignment would read an undeclared value
    // and the whole statement would be dropped.
    expect(analysis.directProgramLines[1]).toBe('hit_1 = 0.0');
  });

  test('unrolls a bounded loop into one copy of the body per iteration', () => {
    const analysis = extractShaderControls(
      nativeBody(`
        float acc_1;
        acc_1 = 0.0;
        for (int i_1 = 0; i_1 < 4; i_1++) {
          acc_1 = (acc_1 + float(i_1));
        };
        ret = vec3(acc_1, 0.0, 0.0);
      `),
    );

    expect(analysis.nativeBodyUnparsedLines).toEqual([]);
    const lines = analysis.directProgramLines;
    // Four copies, each with the induction variable replaced by its value.
    expect(lines.filter((line) => line.startsWith('acc_1 = (acc_1 +'))).toEqual(
      [
        'acc_1 = (acc_1 + float(0))',
        'acc_1 = (acc_1 + float(1))',
        'acc_1 = (acc_1 + float(2))',
        'acc_1 = (acc_1 + float(3))',
      ],
    );
  });

  test('resolves a loop bound held in a local assigned a literal', () => {
    const analysis = extractShaderControls(
      nativeBody(`
        float acc_1;
        float depth_1;
        acc_1 = 0.0;
        depth_1 = 3.0;
        for (float n_1 = 0.0; n_1 < depth_1; n_1 += 1.0) {
          acc_1 = (acc_1 + n_1);
        };
        ret = vec3(acc_1, 0.0, 0.0);
      `),
    );

    expect(analysis.nativeBodyUnparsedLines).toEqual([]);
    expect(
      analysis.directProgramLines.filter((line) =>
        line.startsWith('acc_1 = (acc_1 +'),
      ),
    ).toEqual([
      'acc_1 = (acc_1 + 0.0)',
      'acc_1 = (acc_1 + 1.0)',
      'acc_1 = (acc_1 + 2.0)',
    ]);
  });

  test('composes unrolling with branch flattening inside the body', () => {
    const analysis = extractShaderControls(
      nativeBody(`
        float acc_1;
        acc_1 = 0.0;
        for (int i_1 = 0; i_1 <= 1; i_1++) {
          if ((uv.x < 0.5)) {
            acc_1 = (acc_1 + 1.0);
          };
        };
        ret = vec3(acc_1, 0.0, 0.0);
      `),
    );

    expect(analysis.nativeBodyUnparsedLines).toEqual([]);
    expect(
      analysis.directProgramLines.filter((line) => line.includes('if(')),
    ).toHaveLength(2);
  });

  test('leaves a data-dependent loop bound for the raw-GLSL fallback', () => {
    const analysis = extractShaderControls(
      nativeBody(`
        float acc_1;
        int iter_1;
        acc_1 = 0.0;
        iter_1 = int((q1 * 8.0));
        for (int i_1 = 0; i_1 < iter_1; i_1++) {
          acc_1 = (acc_1 + 1.0);
        };
        ret = vec3(acc_1, 0.0, 0.0);
      `),
    );

    // Refusing has to leave today's behaviour untouched: the body stays
    // unparsed and WebGL runs the raw GLSL.
    expect(analysis.nativeBodyUnparsedLines.length).toBeGreaterThan(0);
  });

  test('leaves an unbounded loop for the raw-GLSL fallback', () => {
    const analysis = extractShaderControls(
      nativeBody(`
        float acc_1;
        acc_1 = 0.0;
        while (true) {
          acc_1 = (acc_1 + 1.0);
          break;
        };
        ret = vec3(acc_1, 0.0, 0.0);
      `),
    );

    expect(analysis.nativeBodyUnparsedLines.length).toBeGreaterThan(0);
  });

  test('refuses a loop whose trip count exceeds the unroll budget', () => {
    const analysis = extractShaderControls(
      nativeBody(`
        float acc_1;
        acc_1 = 0.0;
        for (int i_1 = 0; i_1 < 4096; i_1++) {
          acc_1 = (acc_1 + 1.0);
        };
        ret = vec3(acc_1, 0.0, 0.0);
      `),
    );

    expect(analysis.nativeBodyUnparsedLines.length).toBeGreaterThan(0);
  });
});

describe('shader expression numbers', () => {
  test('parses scientific notation', () => {
    // Compiler-emitted GLSL is full of `1e-08`; stopping the scan at the `e`
    // left a bare identifier behind and failed the whole line.
    expect(parseMilkdropShaderStatement('x = (1e-08 * abs(y))')).not.toBeNull();
    expect(parseMilkdropShaderStatement('x = 2.5E+3')).not.toBeNull();
    expect(parseMilkdropShaderStatement('x = 5e')).toBeNull();
    expect(parseMilkdropShaderStatement('x = 1.2.3')).toBeNull();
  });
});
