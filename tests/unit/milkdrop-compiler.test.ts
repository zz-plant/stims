import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clearCompiledPresetCache,
  compileMilkdropPresetSource,
  getCompiledPresetCacheSize,
} from 'milkdrop-toolchain/src/compiler.ts';

describe('milkdrop compiler', () => {
  test('formatted source keeps warp/comp shader sections and title for shader-bearing presets', () => {
    const fixturePath = join(
      process.cwd(),
      'public',
      'milkdrop-presets',
      'butterchurn',
      '11.milk',
    );
    const compiled = compileMilkdropPresetSource(
      readFileSync(fixturePath, 'utf8'),
      {
        id: 'butterchurn-11',
        title: 'Butterchurn 11',
        origin: 'bundled',
        fileName: '11.milk',
      },
    );

    expect(compiled.ir.shaderText.warp).toBeTruthy();
    expect(compiled.ir.shaderText.comp).toBeTruthy();
    expect(compiled.formattedSource).toContain('[warp_shader]');
    expect(compiled.formattedSource).toContain('[comp_shader]');
    expect(compiled.formattedSource).toContain('title="Butterchurn 11"');
    expect(compiled.formattedSource).not.toContain('MilkDrop Session');

    const recompiled = compileMilkdropPresetSource(compiled.formattedSource, {
      id: 'butterchurn-11-roundtrip',
    });

    expect(recompiled.ir.shaderText.warp).toBe(
      compiled.ir.shaderText.warp as string,
    );
    expect(recompiled.ir.shaderText.comp).toBe(
      compiled.ir.shaderText.comp as string,
    );
    expect(recompiled.ir.shaderText.warpProgram).not.toBeNull();
    expect(recompiled.ir.shaderText.compProgram).not.toBeNull();
    expect(recompiled.ir.shaderText.supported).toBe(
      compiled.ir.shaderText.supported,
    );
    expect(recompiled.ir.title).toBe('Butterchurn 11');

    // A second format→compile generation must be stable.
    const thirdGeneration = compileMilkdropPresetSource(
      recompiled.formattedSource,
      { id: 'butterchurn-11-gen3' },
    );
    expect(thirdGeneration.ir.shaderText.warp).toBe(
      compiled.ir.shaderText.warp as string,
    );
    expect(thirdGeneration.formattedSource).toBe(recompiled.formattedSource);
  });

  test('keeps richer legacy shader programs executable without downgrading them to unsupported shader text', () => {
    const fixturePath = join(
      process.cwd(),
      'tests',
      'fixtures',
      'milkdrop',
      'legacy',
      'legacy-unsupported-full-shader-code.milk',
    );
    const compiled = compileMilkdropPresetSource(
      readFileSync(fixturePath, 'utf8'),
      {
        id: 'legacy-unsupported-full-shader-code',
        title: 'Legacy Unsupported Full Shader Code',
        fileName: 'legacy-unsupported-full-shader-code.milk',
        path: fixturePath,
        origin: 'user',
      },
    );

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.shaderText.unsupportedLines).toEqual([]);
    expect(
      compiled.ir.compatibility.featureAnalysis.unsupportedShaderText,
    ).toBe(false);
    expect(
      compiled.ir.compatibility.featureAnalysis.featuresUsed,
    ).not.toContain('unsupported-shader-text');
    expect(compiled.ir.shaderText.warp).toBe(
      'shader_body=tex2d(sampler_main,uv).rgb;',
    );
    expect(compiled.ir.shaderText.comp).toBe(
      'ret=tex2d(sampler_main,uv).rgb*1.2;',
    );
    expect(compiled.ir.post.shaderControls.colorScale).toEqual({
      r: 1.2,
      g: 1.2,
      b: 1.2,
    });
    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
    expect(compiled.ir.compatibility.backends.webgpu.status).toBe('supported');
    expect(compiled.ir.compatibility.parity.backendDivergence).toEqual([]);
  });

  test('classifies the projectM noisevol fixture as a volume sample on both backends', () => {
    const fixturePath = join(
      process.cwd(),
      'tests',
      'fixtures',
      'milkdrop',
      'projectm-upstream',
      '261-compshader-noisevol_lq.milk',
    );
    const compiled = compileMilkdropPresetSource(
      readFileSync(fixturePath, 'utf8'),
      {
        id: 'projectm-noisevol-fixture',
        title: '261-compshader-noisevol_lq.milk',
        fileName: '261-compshader-noisevol_lq.milk',
        path: fixturePath,
        origin: 'user',
      },
    );

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.post.shaderControls.textureLayer.source).toBe(
      'noisevol',
    );
    expect(compiled.ir.post.shaderControls.textureLayer.sampleDimension).toBe(
      '3d',
    );
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
    expect(compiled.ir.compatibility.parity.backendDivergence).toEqual([]);
    expect(compiled.ir.compatibility.warnings).toEqual([]);
    expect(compiled.ir.compatibility.parity.fidelityClass).toBe('exact');
  });

  test('does not keep richer parity shader programs on the allowlisted-gap path', () => {
    const compiled = compileMilkdropPresetSource(
      readFileSync(
        join(
          process.cwd(),
          'tests',
          'fixtures',
          'milkdrop',
          'parity-corpus',
          'parity-allowlisted-shader-gap.milk',
        ),
        'utf8',
      ),
      { id: 'parity-allowlisted-shader-gap' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.shaderText.unsupportedLines).toEqual([]);
    expect(compiled.ir.compatibility.parity.blockedConstructs).toEqual([]);
    expect(compiled.ir.compatibility.parity.blockingConstructDetails).toEqual(
      [],
    );
    expect(
      compiled.ir.compatibility.parity.degradationReasons.map(
        (reason) => reason.code,
      ),
    ).not.toContain('allowlisted-gap');
    expect(compiled.ir.compatibility.parity.fidelityClass).toBe('exact');
  });

  test('joins per-pixel continuation while parenthesized expression remains open', () => {
    const fixturePath = join(
      process.cwd(),
      'public/milkdrop-presets/libraries/projectm-cream-of-the-crop/illusion-unchained-new-strategy.milk',
    );
    const compiled = compileMilkdropPresetSource(
      readFileSync(fixturePath, 'utf8'),
      {
        id: 'illusion-unchained-new-strategy',
        origin: 'bundled',
        path: fixturePath,
      },
    );

    expect(compiled.ir.programs.perPixel.sourceLines).toContain(
      'zoom=if(Above(q2,q5),zoom+.10*sin(rad-.10+.2-newrad*q4),zoom-.10*cos(rad+.10 +.2+newrad*q5))',
    );
    expect(compiled.diagnostics.map((entry) => entry.code)).not.toContain(
      'expr_expected_comma',
    );
    expect(compiled.diagnostics.map((entry) => entry.code)).not.toContain(
      'expr_expected_closing_paren',
    );
  });
});

describe('packed MilkDrop sampler compatibility', () => {
  const packedSamplerFixtures = [
    'martin-city-of-shadows.milk',
    'martin-tunnel-race.milk',
  ] as const;

  packedSamplerFixtures.forEach((fileName) => {
    test(`keeps packed sampler preset ${fileName} in the direct shader compatibility path`, () => {
      const raw = readFileSync(
        join(
          process.cwd(),
          'public',
          'milkdrop-presets',
          'butterchurn',
          fileName,
        ),
        'utf8',
      );
      const compiled = compileMilkdropPresetSource(raw, {
        id: fileName.replace(/\.milk$/u, ''),
        fileName,
        path: join('public', 'milkdrop-presets', 'butterchurn', fileName),
        origin: 'bundled',
      });

      expect(compiled.ir.shaderText.unsupportedLines).toEqual([]);
      expect(compiled.ir.compatibility.parity.blockedConstructs).not.toContain(
        expect.stringContaining('sampler_pc_main'),
      );
      expect(compiled.ir.compatibility.parity.blockedConstructs).not.toContain(
        expect.stringContaining('sampler_pw_noise_lq'),
      );
    });
  });

  test('preserves packed sampler aliases and executes fc_main directly on WebGPU', () => {
    const compiled = compileMilkdropPresetSource(
      `
title=Packed Sampler Smoke
comp_1=vec2 packed = texture(sampler_pc_main, uv).yz;
comp_2=vec3 noisePacked = texture(sampler_pw_noise_lq, uv).xyz;
comp_3=ret = texture(sampler_fc_main, packed + noisePacked.xy).xyz;
      `.trim(),
      { id: 'packed-sampler-smoke' },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.shaderText.compProgram?.source).toContain(
      'sampler_pc_main',
    );
    expect(compiled.ir.shaderText.compProgram?.source).toContain(
      'sampler_pw_noise_lq',
    );
    expect(compiled.ir.shaderText.compProgram?.source).toContain(
      'sampler_fc_main',
    );
    expect(
      compiled.ir.shaderText.compProgram?.execution.supportedBackends,
    ).toEqual(expect.arrayContaining(['webgpu']));
    expect(compiled.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: 'preset_shader_packed_sampler_backend_gap',
      }),
    );
  });
  test('resolves aliased custom shader sampler declarations case-insensitively', () => {
    // `anandamideCTFree00` is aliased to the noise texture in
    // shader-samplers.ts; the lookup happens after lowercasing, so this also
    // guards the case-folded alias table (a camelCased key there would never
    // match and silently regress to "missing texture").
    const source = readFileSync(
      join(
        process.cwd(),
        'public/milkdrop-presets/butterchurn/martin-anandamide-mandelbox-explorer-quantum-timepiece-remix.milk',
      ),
      'utf8',
    );
    const compiled = compileMilkdropPresetSource(source, {
      id: 'anandamide-custom-sampler',
      origin: 'bundled',
    });

    expect(compiled.ir.shaderText.customSamplers).toContainEqual({
      name: 'sampler_anandamideCTFree00',
      textureFile: 'seamless_perlin_noise.png',
      filter: 'linear',
      wrap: 'repeat',
    });
    expect(compiled.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: 'preset_missing_custom_sampler_texture',
        severity: 'warning',
      }),
    );
  });

  test('reports missing bundled textures for unknown custom samplers', () => {
    const compiled = compileMilkdropPresetSource(
      `
shader=1
comp_shader=uniform sampler2D sampler_definitely_not_bundled; ret = texture(sampler_definitely_not_bundled, uv).rgb
    `.trim(),
      { id: 'unknown-custom-sampler', origin: 'bundled' },
    );

    expect(compiled.ir.shaderText.customSamplers).toContainEqual({
      name: 'sampler_definitely_not_bundled',
      textureFile: null,
      filter: 'linear',
      wrap: 'repeat',
    });
    expect(compiled.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'preset_missing_custom_sampler_texture',
        severity: 'warning',
      }),
    );
  });

  test('resolves custom shader sampler declarations to bundled texture assets', () => {
    const compiled = compileMilkdropPresetSource(
      `
shader=1
comp_shader=uniform sampler2D sampler_water_caustics; ret = texture(sampler_water_caustics, uv).rgb
    `.trim(),
      { id: 'custom-sampler-texture', origin: 'bundled' },
    );

    expect(compiled.ir.shaderText.customSamplers).toEqual([
      {
        name: 'sampler_water_caustics',
        textureFile: 'water_caustics.png',
        filter: 'linear',
        wrap: 'repeat',
      },
    ]);
    expect(
      compiled.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'preset_missing_custom_sampler_texture',
      ),
    ).toBe(false);
  });

  test('load-path compiles with metadata opt into the raw-string cache and reuse the compiled IR', () => {
    clearCompiledPresetCache();

    const raw = `
title="Cached Preset"
fDecay=0.5
    `.trim();
    const source = { id: 'cached-preset', origin: 'bundled' } as const;

    const first = compileMilkdropPresetSource(raw, source, {
      cacheCompile: true,
    });
    const second = compileMilkdropPresetSource(raw, source, {
      cacheCompile: true,
    });

    // A cache hit returns the identical compiled object — the parse+IR
    // rebuild that normally costs several milliseconds is skipped entirely.
    expect(first).toBe(second);
    expect(second.source.id).toBe('cached-preset');
    expect(second.source.origin).toBe('bundled');
    expect(second.formattedSource).not.toBe('');

    clearCompiledPresetCache();
    expect(getCompiledPresetCacheSize()).toBe(0);
  });

  test('the raw-string cache stays keyed by exact source text', () => {
    clearCompiledPresetCache();

    const rawA = 'title="A"\nfDecay=0.5';
    const rawB = 'title="A"\nfDecay=0.6';
    const source = { id: 'cached-a', origin: 'bundled' } as const;

    const a = compileMilkdropPresetSource(rawA, source, { cacheCompile: true });
    const b = compileMilkdropPresetSource(rawB, source, { cacheCompile: true });
    const aAgain = compileMilkdropPresetSource(rawA, source, {
      cacheCompile: true,
    });

    expect(a).not.toBe(b);
    expect(a).toBe(aAgain);
    expect(b.ir.numericFields.decay).toBeCloseTo(0.6, 4);

    clearCompiledPresetCache();
  });
});
