import { expect, test } from 'bun:test';
import type { MilkdropBundledCatalogEntry } from '../assets/js/milkdrop/types.ts';
import catalogJson from '../public/milkdrop-presets/catalog.json' with {
  type: 'json',
};

type BundledCatalogDocument = {
  presets: MilkdropBundledCatalogEntry[];
};

const catalog = catalogJson as BundledCatalogDocument;

const shaderDependentPresetIds = [
  'martin-anandamide-mandelbox-explorer-quantum-timepiece-remix',
  'martin-elusive-impressions-mix2-flacc-mess-proph-nz-2',
  'martin-city-of-shadows',
  'martin-tunnel-race',
  'martin-castle-in-the-air',
];

test('known shader-text-dependent presets are conservatively classified', () => {
  for (const presetId of shaderDependentPresetIds) {
    const preset = catalog.presets.find((entry) => entry.id === presetId);

    expect(preset, presetId).toBeDefined();
    expect(preset?.expectedFidelityClass).toBe('fallback');
    expect(preset?.visualEvidenceTier).toBe('compile');
    expect(preset?.supports).toEqual({ webgl: false, webgpu: false });
    expect(preset?.tags).toContain('shader-text-dependent');
    expect(preset?.tags).toContain('compatibility-fallback');
    expect(preset?.visualCertification).toMatchObject({
      status: 'uncertified',
      measured: false,
      source: 'inferred',
      fidelityClass: 'fallback',
      visualEvidenceTier: 'compile',
      requiredBackend: 'webgpu',
      actualBackend: null,
    });
    expect(preset?.visualCertification?.reasons.join(' ')).toContain(
      'shader-text',
    );
  }
});
