import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import catalogJson from '../../public/milkdrop-presets/catalog.json' with {
  type: 'json',
};
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { assembleMilkdropDirectFragmentShaders } from '../../src/js/milkdrop/feedback-manager-shared.ts';
import type { MilkdropBundledCatalogEntry } from '../../src/js/milkdrop/types.ts';

type BundledCatalogDocument = {
  presets: MilkdropBundledCatalogEntry[];
};

const catalog = catalogJson as BundledCatalogDocument;

const nativeShaderPresetIds = [
  'martin-anandamide-mandelbox-explorer-quantum-timepiece-remix',
  'martin-elusive-impressions-mix2-flacc-mess-proph-nz-2',
  'martin-city-of-shadows',
  'martin-tunnel-race',
  'martin-castle-in-the-air',
];

test('known native shader-text presets are no longer cataloged as fallback compile-only', () => {
  for (const presetId of nativeShaderPresetIds) {
    const preset = catalog.presets.find((entry) => entry.id === presetId);

    expect(preset, presetId).toBeDefined();
    expect(preset?.expectedFidelityClass).not.toBe('fallback');
    expect(preset?.visualEvidenceTier).not.toBe('compile');
    expect(preset?.supports).toEqual({ webgl: true, webgpu: true });
    expect(preset?.tags ?? []).not.toContain('compatibility-fallback');
    expect(preset?.visualCertification).toMatchObject({
      status: 'uncertified',
      measured: false,
      source: 'inferred',
      fidelityClass: 'partial',
      visualEvidenceTier: 'runtime',
      requiredBackend: 'webgpu',
      actualBackend: null,
    });
  }
});

test('known native shader-text presets advertise raw-preserved bodies as direct on webgl', () => {
  for (const presetId of nativeShaderPresetIds) {
    const source = readFileSync(
      join(
        process.cwd(),
        'public',
        'milkdrop-presets',
        'butterchurn',
        `${presetId}.milk`,
      ),
      'utf8',
    );
    const compiled = compileMilkdropPresetSource(source, {
      id: presetId,
      origin: 'bundled',
    });

    expect(compiled.ir.shaderText.supported, presetId).toBe(true);
    expect(compiled.ir.shaderText.unsupportedLines, presetId).toEqual([]);
    expect(
      compiled.ir.compatibility.featureAnalysis.shaderTextExecution.webgl,
      presetId,
    ).toBe('direct');
    expect(
      typeof compiled.ir.compatibility.featureAnalysis.shaderTextExecution
        .webgpu,
      presetId,
    ).toBe('string');
    expect(compiled.ir.compatibility.backends.webgl.status, presetId).not.toBe(
      'fallback',
    );
    expect(compiled.ir.compatibility.backends.webgpu.status, presetId).not.toBe(
      'fallback',
    );
    expect(
      compiled.ir.shaderText.warpProgram || compiled.ir.shaderText.compProgram,
      presetId,
    ).not.toBeNull();
    for (const program of [
      compiled.ir.shaderText.warpProgram,
      compiled.ir.shaderText.compProgram,
    ]) {
      if (!program) {
        continue;
      }
      expect(program.rawGlsl, presetId).toBeString();
      expect(Array.isArray(program.statements), presetId).toBe(true);
      expect(Array.isArray(program.execution.supportedBackends), presetId).toBe(
        true,
      );
      expect(typeof program.execution.requiresControlFallback, presetId).toBe(
        'boolean',
      );
    }
  }
});

test('elusive impressions fixture exercises MilkDrop volume-noise shader text without certification upgrade', () => {
  const presetId = 'martin-elusive-impressions-mix2-flacc-mess-proph-nz-2';
  const preset = catalog.presets.find((entry) => entry.id === presetId);
  const source = readFileSync(
    join(
      import.meta.dir,
      '../../public/milkdrop-presets/butterchurn/martin-elusive-impressions-mix2-flacc-mess-proph-nz-2.milk',
    ),
    'utf8',
  );

  expect(source).toContain('texture (sampler_noisevol_hq,');
  expect(source).toContain('texsize_noisevol_hq.zww');
  expect(preset?.supports).toEqual({ webgl: true, webgpu: true });
  expect(preset?.visualCertification).toMatchObject({
    status: 'uncertified',
    measured: false,
    source: 'inferred',
    fidelityClass: 'partial',
    visualEvidenceTier: 'runtime',
  });
  expect(preset?.visualCertification?.reasons).toContain(
    'Native shader_body GLSL executes on WebGL via the raw-preserved path; retained at partial/runtime because volume sampler parity remains approximate and unmeasured.',
  );
});

// Presets whose assembled WebGL fragment shaders failed to compile before the
// templates declared the MilkDrop shader-input surface:
// - '86' read q30 ("'q30' : undeclared identifier"; q18/q22/q32 in neighbors)
// - 'martin-stormy-sea-2009' read _qb.xy ("'xy' : field selection requires
//   structure, vector, or interface block") and sampled volume noise with a
//   vec3 coordinate, which texture2D cannot take
// - 'flexi-geiss-tokamak-fallout-repellor' was the preset reported failing
//   during autoplay
// - '36' reads roam_cos / rand_preset
const builtinDependentPresetIds = [
  '86',
  '36',
  'martin-stormy-sea-2009',
  'flexi-geiss-tokamak-fallout-repellor',
];

function assembleShadersForPreset(presetId: string) {
  const source = readFileSync(
    join(
      process.cwd(),
      'public',
      'milkdrop-presets',
      'butterchurn',
      `${presetId}.milk`,
    ),
    'utf8',
  );
  const compiled = compileMilkdropPresetSource(source, {
    id: presetId,
    origin: 'bundled',
  });
  const warpGlsl = compiled.ir.shaderText.warpProgram?.rawGlsl ?? null;
  const compGlsl = compiled.ir.shaderText.compProgram?.rawGlsl ?? null;
  return {
    warpGlsl,
    compGlsl,
    ...assembleMilkdropDirectFragmentShaders(warpGlsl, compGlsl),
  };
}

test('assembled WebGL fragment shaders declare every MilkDrop builtin the preset bodies reference', () => {
  for (const presetId of builtinDependentPresetIds) {
    const { warpGlsl, compGlsl, warp, composite } =
      assembleShadersForPreset(presetId);
    expect(warpGlsl ?? compGlsl, presetId).not.toBeNull();

    for (const [kind, shader] of [
      ['warp', warp],
      ['composite', composite],
    ] as const) {
      const label = `${presetId} ${kind}`;
      // Packed q uniforms with q1..q32 defines (butterchurn layout).
      expect(shader, label).toContain('uniform vec4 _qa;');
      expect(shader, label).toContain('uniform vec4 _qh;');
      expect(shader, label).toContain('#define q1 _qa.x');
      expect(shader, label).toContain('#define q30 _qh.y');
      expect(shader, label).toContain('#define q32 _qh.w');
      // MilkDrop aspect is a vec4 (.xy multipliers, .zw inverses); a float
      // uniform here regresses to "field selection on scalar" errors.
      expect(shader, label).toContain('uniform vec4 aspect;');
      expect(shader, label).not.toContain('uniform float aspect;');
      // Per-pixel rad/ang are in scope for injected bodies.
      expect(shader, label).toContain('float rad = length(uv - 0.5);');
      expect(shader, label).toContain(
        'float ang = atan(uv.x - 0.5, uv.y - 0.5);',
      );
      // Roam oscillators and per-preset randoms.
      expect(shader, label).toContain('#define roam_cos');
      expect(shader, label).toContain('#define slow_roam_sin');
      expect(shader, label).toContain('uniform vec4 rand_preset;');
      // Every qN the preset references must be covered by a define.
      for (const match of shader.matchAll(/\bq(\d+)\b/g)) {
        const index = Number(match[1]);
        expect(index, `${label} references q${match[1]}`).toBeGreaterThan(0);
        expect(index, `${label} references q${match[1]}`).toBeLessThanOrEqual(
          32,
        );
      }
    }
  }
});

test('preset shader bodies are injected into the assembled fragment shaders', () => {
  const { warp } = assembleShadersForPreset(
    'flexi-geiss-tokamak-fallout-repellor',
  );
  // A distinctive statement from the preset's warp shader_body.
  expect(warp).toContain('ret_1.yzx');

  const stormySea = assembleShadersForPreset('martin-stormy-sea-2009');
  expect(stormySea.composite).toContain('_qb.xy');
});

// Presets referencing custom-texture size uniforms (texsize_mcode1,
// texsize_cells, …). MilkDrop injects those uniforms at runtime; this pipeline
// does not, so any occurrence left unrewritten reaches the WebGL fragment
// shader as an undeclared identifier and the material fails to compile.
const customTexsizePresetIds = [
  'adam-fx-2-zylot-age-of-science-fierceness-16-mash0000-gerber-full-heaving-baby',
  'adam-fx-2-zylot-age-of-science-fierceness-beast2-mash0000-ethics-is-for-weiner-dogs',
  'adam-fx-2-zylot-age-of-science-fierceness-starburst-5-mash0000',
  'cope-keanu-reeves-is-a-bad-actor',
  'cope-matrixcode7',
  'geiss-drop-shadow-1',
  'geiss-drop-shadow-2',
  'martin-test',
  'stahlregen-fishbrain-flexi-geiss-the-machine-that-conquered-the-aether',
  'yin-geiss-240-electric-universe-bkg-mix',
  'zylot-age-of-science-seeking-truth-mix',
  'zylot-heaven-bloom-nz',
];

test('custom-texture texsize identifiers never survive into executable GLSL', () => {
  for (const presetId of customTexsizePresetIds) {
    const { warpGlsl, compGlsl, warp, composite } =
      assembleShadersForPreset(presetId);
    expect(warpGlsl ?? compGlsl, presetId).not.toBeNull();
    for (const [kind, glsl] of [
      ['warp program', warpGlsl],
      ['comp program', compGlsl],
      ['assembled warp', warp],
      ['assembled composite', composite],
    ] as const) {
      if (glsl === null) {
        continue;
      }
      expect(glsl, `${presetId} ${kind}`).not.toMatch(/\btexsize_/);
    }
  }
});

test('vec3 volume-noise samples are routed through sampleNoiseVolume', () => {
  const { warp } = assembleShadersForPreset('martin-stormy-sea-2009');
  expect(warp).toContain('vec4 sampleNoiseVolume(vec3 p)');
  expect(warp).toContain('sampleNoiseVolume(');
  // The original tex3D-style call must not survive as a texture2D overload
  // mismatch on the simplex atlas texture.
  expect(warp).not.toMatch(/texture2D\s*\(\s*simplexTex\s*,\s*\(?\s*vec3/);
});

test('synthetic q-var and aspect swizzle bodies assemble into compilable declarations', () => {
  const { warp } = assembleMilkdropDirectFragmentShaders(
    'shader_body { ret = vec3(q30, q18, q22) * (uv * aspect.xy).x; }',
    null,
  );
  expect(warp).toContain('#define q18 _qe.y');
  expect(warp).toContain('#define q22 _qf.y');
  expect(warp).toContain('#define q30 _qh.y');
  expect(warp).toContain('uniform vec4 aspect;');
  expect(warp).toContain('ret = vec3(q30, q18, q22) * (uv * aspect.xy).x;');
});
