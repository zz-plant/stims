import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import type { MilkdropBundledCatalogEntry } from '../assets/js/milkdrop/types.ts';
import catalogJson from '../public/milkdrop-presets/catalog.json' with {
  type: 'json',
};

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

test('known native shader-text presets compile to direct shader-text programs', () => {
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
    const expectsWebGpuTranslation =
      presetId ===
      'martin-anandamide-mandelbox-explorer-quantum-timepiece-remix';
    expect(
      compiled.ir.compatibility.featureAnalysis.shaderTextExecution,
      presetId,
    ).toEqual({
      webgl: 'direct',
      webgpu: expectsWebGpuTranslation ? 'translated' : 'direct',
    });
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
  }
});

test('elusive impressions fixture exercises MilkDrop volume-noise shader text without certification upgrade', () => {
  const presetId = 'martin-elusive-impressions-mix2-flacc-mess-proph-nz-2';
  const preset = catalog.presets.find((entry) => entry.id === presetId);
  const source = readFileSync(
    join(
      import.meta.dir,
      '../public/milkdrop-presets/butterchurn/martin-elusive-impressions-mix2-flacc-mess-proph-nz-2.milk',
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
    'Direct native shader_body extraction now recognizes volume-noise shader text, texsize_noisevol_hq aliases, and feedback sampler reads; retained at partial/runtime because volume sampler translation remains approximate and unmeasured.',
  );
});
