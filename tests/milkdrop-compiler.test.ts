import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';

describe('milkdrop compiler', () => {
  test('compiles preset metadata, scalars, and program statements', () => {
    const compiled = compileMilkdropPresetSource(
      `
title="Smoke Preset"
author=Test Runner
fDecay=0.91
wave_r=0.2 + 0.3
init_1=q1 = 0.4;
per_frame_1=q1 = q1 + 0.1; wave_a = min(1, wave_a + 0.02);
per_pixel_1=zoom = zoom + 0.0;
      `.trim(),
      { id: 'smoke-preset', origin: 'bundled' },
    );

    expect(compiled.source.id).toBe('smoke-preset');
    expect(compiled.title).toBe('Smoke Preset');
    expect(compiled.author).toBe('Test Runner');
    expect(compiled.ir.numericFields.decay).toBeCloseTo(0.91, 4);
    expect(compiled.ir.numericFields.wave_r).toBeCloseTo(0.5, 4);
    expect(compiled.ir.programs.init.statements.length).toBe(1);
    expect(compiled.ir.programs.perFrame.statements.length).toBe(2);
    expect(compiled.ir.programs.perPixel.statements.length).toBe(1);
    expect(compiled.ir.compatibility.featureAnalysis.registerUsage.q).toBe(1);
    expect(compiled.ir.compatibility.featureAnalysis.featuresUsed).toContain(
      'per-frame-equations',
    );
    expect(
      compiled.diagnostics.some((entry) => entry.severity === 'error'),
    ).toBe(false);
    expect(compiled.formattedSource).toContain('title="Smoke Preset"');
  });

  test('classifies backend support and feature usage for feedback presets', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Compat Flag
video_echo=1
      `.trim(),
      { id: 'compat-flag' },
    );

    expect(compiled.ir.compatibility.unsupportedKeys).toEqual([]);
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
    expect(compiled.ir.compatibility.backends.webgpu.status).toBe('supported');
    expect(compiled.ir.compatibility.featureAnalysis.featuresUsed).toContain(
      'video-echo',
    );
    expect(compiled.ir.compatibility.blockingReasons).toEqual([]);
  });

  test('maps gamma adjustment into post state and post-effect feature usage', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Gamma Flag
fGammaAdj=1.75
      `.trim(),
      { id: 'gamma-flag' },
    );

    expect(compiled.ir.numericFields.gammaadj).toBeCloseTo(1.75, 6);
    expect(compiled.ir.post.gammaAdj).toBeCloseTo(1.75, 6);
    expect(compiled.ir.compatibility.featureAnalysis.featuresUsed).toContain(
      'post-effects',
    );
  });

  test('accepts motion vector fields as supported preset inputs', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Motion Vectors
motion_vectors=1
motion_vectors_x=11
motion_vectors_y=7
mv_r=0.2
mv_g=0.4
mv_b=0.9
mv_a=0.3
      `.trim(),
      { id: 'motion-vectors' },
    );

    expect(compiled.ir.compatibility.unsupportedKeys).toEqual([]);
    expect(compiled.ir.numericFields.motion_vectors).toBe(1);
    expect(compiled.ir.numericFields.motion_vectors_x).toBe(11);
    expect(compiled.ir.numericFields.motion_vectors_y).toBe(7);
    expect(compiled.ir.compatibility.featureAnalysis.featuresUsed).toContain(
      'motion-vectors',
    );
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
  });

  test('maps warp animation speed into numeric fields', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Warp Speed
fWarpAnimSpeed=1.88
      `.trim(),
      { id: 'warp-speed' },
    );

    expect(compiled.ir.numericFields.warpanimspeed).toBeCloseTo(1.88, 6);
    expect(compiled.ir.compatibility.unsupportedKeys).toEqual([]);
  });

  test('maps wave alpha modulation and shader flags into numeric fields', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Wave Alpha Mod
fModWaveAlphaStart=1.2
fModWaveAlphaEnd=0.3
fShader=0
      `.trim(),
      { id: 'wave-alpha-mod' },
    );

    expect(compiled.ir.numericFields.modwavealphastart).toBeCloseTo(1.2, 6);
    expect(compiled.ir.numericFields.modwavealphaend).toBeCloseTo(0.3, 6);
    expect(compiled.ir.numericFields.shader).toBe(0);
    expect(compiled.ir.post.shaderEnabled).toBe(false);
  });

  test('supports shader-text subset and feedback-style flags', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Shader Subset
warp_shader=warp=0.9; hue=0.35
comp_shader=mix=0.25; tint=1,0.6,0.4
texture_wrap=1
feedback_texture=1
ob_border=1
ib_border=1
      `.trim(),
      { id: 'shader-subset' },
    );

    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
    expect(compiled.ir.compatibility.backends.webgpu.status).toBe('supported');
    expect(
      compiled.ir.compatibility.featureAnalysis.unsupportedShaderText,
    ).toBe(false);
    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.post.textureWrap).toBe(true);
    expect(compiled.ir.post.feedbackTexture).toBe(true);
    expect(compiled.ir.post.outerBorderStyle).toBe(true);
    expect(compiled.ir.post.innerBorderStyle).toBe(true);
    expect(compiled.ir.post.shaderControls.hueShift).toBeCloseTo(0.35, 6);
    expect(compiled.ir.post.shaderControls.mixAlpha).toBeCloseTo(0.25, 6);
  });

  test('supports shader transform controls in the subset', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Shader Transform
warp_shader=dx=0.08; dy=-0.04; rot=0.3; zoom=1.15
      `.trim(),
      { id: 'shader-transform' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.post.shaderControls.offsetX).toBeCloseTo(0.08, 6);
    expect(compiled.ir.post.shaderControls.offsetY).toBeCloseTo(-0.04, 6);
    expect(compiled.ir.post.shaderControls.rotation).toBeCloseTo(0.3, 6);
    expect(compiled.ir.post.shaderControls.zoom).toBeCloseTo(1.15, 6);
  });

  test('supports shader color controls in the subset', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Shader Color
comp_shader=saturation=1.3; contrast=1.15; r=1.1; g=0.8; b=0.6
      `.trim(),
      { id: 'shader-color' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.post.shaderControls.saturation).toBeCloseTo(1.3, 6);
    expect(compiled.ir.post.shaderControls.contrast).toBeCloseTo(1.15, 6);
    expect(compiled.ir.post.shaderControls.colorScale.r).toBeCloseTo(1.1, 6);
    expect(compiled.ir.post.shaderControls.colorScale.g).toBeCloseTo(0.8, 6);
    expect(compiled.ir.post.shaderControls.colorScale.b).toBeCloseTo(0.6, 6);
  });

  test('supports shader expressions in the subset', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Shader Expressions
warp_shader=dx=sin(pi/2)*0.08; rot=pi/6; zoom=1+0.15
comp_shader=saturation=1+0.2; mix=0.1+0.05; tint=1, 0.4+0.2, sqrt(0.25)+0.1
      `.trim(),
      { id: 'shader-expressions' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.post.shaderControls.offsetX).toBeCloseTo(0.08, 6);
    expect(compiled.ir.post.shaderControls.rotation).toBeCloseTo(
      Math.PI / 6,
      6,
    );
    expect(compiled.ir.post.shaderControls.zoom).toBeCloseTo(1.15, 6);
    expect(compiled.ir.post.shaderControls.saturation).toBeCloseTo(1.2, 6);
    expect(compiled.ir.post.shaderControls.mixAlpha).toBeCloseTo(0.15, 6);
    expect(compiled.ir.post.shaderControls.tint.g).toBeCloseTo(0.6, 6);
    expect(compiled.ir.post.shaderControls.tint.b).toBeCloseTo(0.6, 6);
  });

  test('preserves runtime-driven shader expressions for vm evaluation', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Shader Runtime Expressions
warp_shader=dx=bass_att*0.1; rot=time*0.5
comp_shader=mix=beat_pulse*0.5; tint=1, mid, treb_att+0.2
      `.trim(),
      { id: 'shader-runtime-expressions' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.post.shaderControlExpressions.offsetX).not.toBeNull();
    expect(compiled.ir.post.shaderControlExpressions.rotation).not.toBeNull();
    expect(compiled.ir.post.shaderControlExpressions.mixAlpha).not.toBeNull();
    expect(compiled.ir.post.shaderControlExpressions.tint.g).not.toBeNull();
  });

  test('supports shader declarations, compound assignment, and conditional helper math', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Shader Extended Syntax
warp_shader=float dx = 0.02; dx += if(above(bass_att,0.5), 0.03, 0.01); rot = mix(0, pi/2, 0.5); zoom *= smoothstep(0, 1, 0.5)
comp_shader=const mix = 0.1; mix += step(0.2, beat_pulse) * 0.15; saturation = lerp(1, 1.4, 0.5); contrast = sigmoid(1, 2); tint += 0.1, mod(0.7, 0.4), fmod(0.9, 0.5)
      `.trim(),
      { id: 'shader-extended-syntax' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.post.shaderControls.offsetX).toBeCloseTo(0.03, 6);
    expect(compiled.ir.post.shaderControls.rotation).toBeCloseTo(
      Math.PI / 4,
      6,
    );
    expect(compiled.ir.post.shaderControls.zoom).toBeCloseTo(0.5, 6);
    expect(compiled.ir.post.shaderControls.mixAlpha).toBeCloseTo(0.1, 6);
    expect(compiled.ir.post.shaderControls.saturation).toBeCloseTo(1.2, 6);
    expect(compiled.ir.post.shaderControls.tint.r).toBeCloseTo(1.1, 6);
    expect(compiled.ir.post.shaderControls.tint.g).toBeCloseTo(1.3, 6);
    expect(compiled.ir.post.shaderControls.tint.b).toBeCloseTo(1.4, 6);
    expect(compiled.ir.post.shaderControlExpressions.offsetX).not.toBeNull();
  });

  test('supports shader temp variables before control assignment', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Shader Temp Vars
warp_shader=float drift = bass_att * 0.05; dx = drift; rot = drift * 4
comp_shader=const pulse = beat_pulse * 0.4; mix = pulse; tint = 1, pulse + 0.2, pulse + 0.4
      `.trim(),
      { id: 'shader-temp-vars' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
    expect(compiled.ir.post.shaderControls.offsetX).toBeCloseTo(0, 6);
    expect(compiled.ir.post.shaderControls.mixAlpha).toBeCloseTo(0, 6);
  });

  test('supports common tex2d shader program patterns', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Tex2D Shader Program
warp_shader=shader_body=tex2d(sampler_main,uv).rgb;
comp_shader=ret=tex2d(sampler_main,uv).rgb*1.2;
      `.trim(),
      { id: 'tex2d-shader-program' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
    expect(compiled.ir.post.shaderControls.colorScale.r).toBeCloseTo(1.2, 6);
    expect(compiled.ir.post.shaderControls.colorScale.g).toBeCloseTo(1.2, 6);
    expect(compiled.ir.post.shaderControls.colorScale.b).toBeCloseTo(1.2, 6);
    expect(compiled.ir.shaderText.warpAst).toHaveLength(1);
    expect(compiled.ir.shaderText.compAst).toHaveLength(1);
  });

  test('supports affine uv shader-body transforms', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Affine UV Shader
warp_shader=uv=(uv-0.5)/1.25+0.5+vec2(0.03,-0.02);
      `.trim(),
      { id: 'affine-uv-shader' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
    expect(compiled.ir.post.shaderControls.zoom).toBeCloseTo(0.8, 6);
    expect(compiled.ir.post.shaderControls.offsetX).toBeCloseTo(0.03, 6);
    expect(compiled.ir.post.shaderControls.offsetY).toBeCloseTo(-0.02, 6);
  });

  test('supports mix-based shader-body post patterns', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Mix Shader Body
comp_shader=ret=mix(tex2d(sampler_main,uv).rgb,1.0-tex2d(sampler_main,uv).rgb,0.35);
      `.trim(),
      { id: 'mix-shader-body' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
    expect(compiled.ir.post.shaderControls.invertBoost).toBeCloseTo(0.35, 6);
  });

  test('supports vec2 and vec3 temp variables in shader programs', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Shader Vector Temps
warp_shader=vec2 drift = vec2(0.03, -0.02); uv += drift;
comp_shader=vec3 scale = vec3(1.2, 0.9, 0.7); ret = tex2d(sampler_main, uv).rgb * scale;
      `.trim(),
      { id: 'shader-vector-temps' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
    expect(compiled.ir.post.shaderControls.offsetX).toBeCloseTo(0.03, 6);
    expect(compiled.ir.post.shaderControls.offsetY).toBeCloseTo(-0.02, 6);
    expect(compiled.ir.post.shaderControls.colorScale.r).toBeCloseTo(1.2, 6);
    expect(compiled.ir.post.shaderControls.colorScale.g).toBeCloseTo(0.9, 6);
    expect(compiled.ir.post.shaderControls.colorScale.b).toBeCloseTo(0.7, 6);
  });

  test('supports resolved temp shader outputs for invert and runtime tint mixes', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Shader Resolved Temp Outputs
warp_shader=vec2 drift = vec2(bass_att * 0.03, -treb_att * 0.02); uv = uv + drift;
comp_shader=float pulse = 0.35; vec3 inverted = 1.0 - tex2d(sampler_main, uv).rgb; ret = mix(tex2d(sampler_main, uv).rgb, inverted, pulse); vec3 wash = vec3(1.4, 1.1, 0.8); tint = wash;
      `.trim(),
      { id: 'shader-resolved-temp-outputs' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
    expect(compiled.ir.post.shaderControls.invertBoost).toBeCloseTo(0.35, 6);
    expect(compiled.ir.post.shaderControlExpressions.offsetX).not.toBeNull();
    expect(compiled.ir.post.shaderControlExpressions.offsetY).not.toBeNull();
    expect(compiled.ir.post.shaderControls.tint.r).toBeCloseTo(1.4, 6);
    expect(compiled.ir.post.shaderControls.tint.g).toBeCloseTo(1.1, 6);
    expect(compiled.ir.post.shaderControls.tint.b).toBeCloseTo(0.8, 6);
  });

  test('supports ninth custom wave and shape definitions', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Extended Custom Slots Nine
wavecode_8_enabled=1
wavecode_8_samples=40
wave_8_per_point1=x=x+0.015;
shapecode_8_enabled=1
shapecode_8_sides=11
shape_8_per_frame1=rad=0.14+bass_att*0.02;
      `.trim(),
      { id: 'extended-custom-slots-nine' },
    );

    expect(compiled.ir.customWaves).toHaveLength(1);
    expect(compiled.ir.customWaves[0]?.index).toBe(9);
    expect(compiled.ir.customShapes).toHaveLength(1);
    expect(compiled.ir.customShapes[0]?.index).toBe(9);
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
  });

  test('supports fifth custom wave and shape definitions', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Extended Custom Slots
wavecode_4_enabled=1
wavecode_4_samples=32
wave_4_per_point1=x=x+0.01;
shapecode_4_enabled=1
shapecode_4_sides=9
shape_4_per_frame1=rad=0.16+bass_att*0.03;
      `.trim(),
      { id: 'extended-custom-slots' },
    );

    expect(compiled.ir.customWaves).toHaveLength(1);
    expect(compiled.ir.customWaves[0]?.index).toBe(5);
    expect(compiled.ir.customWaves[0]?.fields.enabled).toBe(1);
    expect(compiled.ir.customShapes).toHaveLength(1);
    expect(compiled.ir.customShapes[0]?.index).toBe(5);
    expect(compiled.ir.customShapes[0]?.fields.sides).toBe(9);
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
  });

  test('supports legacy max-slot custom wave aliases without warnings', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Legacy Max Wave Slot
wavecode_32_enabled=1
wavecode_32_samples=64
wave_32_per_point1=x=x+0.02;
video_echo=1
      `.trim(),
      { id: 'legacy-max-wave-slot' },
    );

    expect(compiled.ir.customWaves).toHaveLength(1);
    expect(compiled.ir.customWaves[0]?.index).toBe(32);
    expect(compiled.ir.customWaves[0]?.fields.enabled).toBe(1);
    expect(compiled.ir.customWaves[0]?.fields.samples).toBe(64);
    expect(
      compiled.ir.customWaves[0]?.programs.perPoint.statements.length,
    ).toBe(1);
    expect(compiled.ir.compatibility.unsupportedKeys).toEqual([]);
    expect(compiled.ir.compatibility.warnings).toEqual([]);
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
    expect(compiled.ir.compatibility.backends.webgpu.status).toBe('supported');
  });

  test('supports legacy max-slot custom shape aliases without warnings', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Legacy Max Shape Slot
shapecode_32_enabled=1
shapecode_32_sides=6
shape_32_per_frame1=rad=0.24;
ob_border=1
fOuterBorderSize=0.01
      `.trim(),
      { id: 'legacy-max-shape-slot' },
    );

    expect(compiled.ir.customShapes).toHaveLength(1);
    expect(compiled.ir.customShapes[0]?.index).toBe(32);
    expect(compiled.ir.customShapes[0]?.fields.enabled).toBe(1);
    expect(compiled.ir.customShapes[0]?.fields.sides).toBe(6);
    expect(
      compiled.ir.customShapes[0]?.programs.perFrame.statements.length,
    ).toBe(1);
    expect(compiled.ir.compatibility.unsupportedKeys).toEqual([]);
    expect(compiled.ir.compatibility.warnings).toEqual([]);
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
    expect(compiled.ir.compatibility.backends.webgpu.status).toBe('supported');
  });

  test('surfaces diagnostics for invalid scalar expressions', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Bad Scalar
wave_r=bad(
      `.trim(),
      { id: 'bad-scalar' },
    );

    expect(
      compiled.diagnostics.some(
        (entry) => entry.code === 'preset_invalid_scalar',
      ),
    ).toBe(true);
    expect(
      compiled.diagnostics.some((entry) => entry.severity === 'error'),
    ).toBe(true);
  });

  test('parses custom waves, custom shapes, and shader-text incompatibility', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Structured Preset
wavecode_0_enabled=1
wavecode_0_samples=48
wave_0_per_point1=y = y + sin(sample * pi * 4) * 0.1
shapecode_0_enabled=1
shapecode_0_sides=7
shape_0_per_frame1=rad = 0.2 + bass_att * 0.05
warp_shader=this is unsupported
      `.trim(),
      { id: 'structured-preset' },
    );

    expect(compiled.ir.customWaves.length).toBe(1);
    expect(compiled.ir.customWaves[0]?.fields.enabled).toBe(1);
    expect(
      compiled.ir.customWaves[0]?.programs.perPoint.statements.length,
    ).toBe(1);
    expect(compiled.ir.customShapes.length).toBe(1);
    expect(compiled.ir.customShapes[0]?.fields.sides).toBe(7);
    expect(compiled.ir.compatibility.featureAnalysis.featuresUsed).toContain(
      'unsupported-shader-text',
    );
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('partial');
    expect(compiled.ir.compatibility.parity.approximatedShaderLines).toEqual([
      'this is unsupported',
    ]);
    expect(compiled.ir.compatibility.parity.blockedConstructs).toEqual([
      'shader:this is unsupported',
    ]);
    expect(compiled.ir.compatibility.parity.parityReady).toBe(false);
    expect(compiled.formattedSource).toContain('wavecode_0_enabled=1');
    expect(compiled.formattedSource).toContain('shapecode_0_enabled=1');
  });

  test('fails parity mode when ignored fields are encountered', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Parity Blocked Field
definitely_not_a_real_field=1
      `.trim(),
      { id: 'parity-blocked-field' },
      { fidelityMode: 'parity' },
    );

    expect(compiled.ir.compatibility.backends.webgl.status).toBe('unsupported');
    expect(compiled.ir.compatibility.backends.webgpu.status).toBe(
      'unsupported',
    );
    expect(compiled.ir.compatibility.parity.ignoredFields).toEqual([
      'definitely_not_a_real_field',
    ]);
    expect(compiled.ir.compatibility.parity.blockedConstructs).toEqual([
      'field:definitely_not_a_real_field',
    ]);
    expect(
      compiled.diagnostics.some(
        (entry) => entry.code === 'preset_parity_blocked',
      ),
    ).toBe(true);
  });

  test('fails parity mode when shader text is approximated', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Parity Blocked Shader
warp_shader=unsupported(shader)
      `.trim(),
      { id: 'parity-blocked-shader' },
      { fidelityMode: 'parity' },
    );

    expect(compiled.ir.compatibility.backends.webgl.status).toBe('unsupported');
    expect(compiled.ir.compatibility.backends.webgpu.status).toBe(
      'unsupported',
    );
    expect(compiled.ir.compatibility.parity.approximatedShaderLines).toEqual([
      'unsupported(shader)',
    ]);
    expect(compiled.ir.compatibility.parity.blockedConstructs).toEqual([
      'shader:unsupported(shader)',
    ]);
    expect(compiled.ir.compatibility.parity.visualFallbacks).toContain(
      'shader-text-control-extraction',
    );
  });

  test('respects parity allowlist entries for known blocked constructs', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Parity Allowlist
warp_shader=unsupported(shader)
      `.trim(),
      { id: 'parity-allowlist' },
      {
        fidelityMode: 'parity',
        parityAllowlist: [
          {
            presetId: 'parity-allowlist',
            blockedConstruct: 'shader:unsupported(shader)',
            owner: 'codex',
            expiry: '2026-06-30',
          },
        ],
      },
    );

    expect(compiled.ir.compatibility.backends.webgl.status).toBe('partial');
    expect(compiled.ir.compatibility.backends.webgpu.status).toBe('partial');
    expect(
      compiled.ir.compatibility.parity.allowlistedBlockedConstructs,
    ).toEqual(['shader:unsupported(shader)']);
    expect(compiled.ir.compatibility.parity.parityReady).toBe(false);
    expect(
      compiled.diagnostics.some(
        (entry) => entry.code === 'preset_parity_blocked',
      ),
    ).toBe(false);
  });
});
