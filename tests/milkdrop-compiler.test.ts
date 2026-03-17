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
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('unsupported');
    expect(compiled.formattedSource).toContain('wavecode_0_enabled=1');
    expect(compiled.formattedSource).toContain('shapecode_0_enabled=1');
  });
});
