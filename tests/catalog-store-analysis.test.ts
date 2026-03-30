import { expect, test } from 'bun:test';
import { getValidatedCatalogOverrides } from '../assets/js/milkdrop/catalog-store-analysis.ts';
import { toCatalogEntry } from '../assets/js/milkdrop/catalog-store-projection.ts';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';

test('measured visual results override inferred fidelity and evidence tier', () => {
  const compiled = compileMilkdropPresetSource(
    'title=Measured Visual Preset\nvideo_echo=1\nwavecode_0_enabled=1\n',
    {
      id: 'measured-visual',
      title: 'Measured Visual Preset',
      origin: 'bundled',
    },
  );

  const overrides = getValidatedCatalogOverrides(
    {
      id: 'measured-visual',
      title: 'Measured Visual Preset',
      file: '/milkdrop-presets/measured-visual.milk',
    },
    compiled,
    [
      {
        id: 'measured-visual',
        fidelityClass: 'near-exact',
        visualEvidenceTier: 'visual',
        suiteStatus: 'pass',
        certificationStatus: 'certified',
        certificationReason: null,
        requiredBackend: 'webgpu',
        actualBackend: 'webgpu',
      },
    ],
  );

  expect(overrides).toEqual(
    expect.objectContaining({
      expectedFidelityClass: 'near-exact',
      visualEvidenceTier: 'visual',
      evidence: {
        ...compiled.ir.compatibility.parity.evidence,
        runtime: 'smoke-tested',
        visual: 'reference-suite',
      },
      visualCertification: {
        status: 'certified',
        measured: true,
        source: 'reference-suite',
        fidelityClass: 'near-exact',
        visualEvidenceTier: 'visual',
        requiredBackend: 'webgpu',
        actualBackend: 'webgpu',
        reasons: [],
      },
    }),
  );
});

test('bundled catalog entries downgrade optimistic labels without measured evidence', () => {
  const source = {
    id: 'bundled-exact',
    title: 'Bundled Exact',
    raw: 'title=Bundled Exact\n',
    origin: 'bundled' as const,
  };
  const compiled = compileMilkdropPresetSource(source.raw, source);

  const entry = toCatalogEntry(source, compiled, null, {
    expectedFidelityClass: 'exact',
    visualEvidenceTier: 'visual',
    certification: 'bundled',
    corpusTier: 'bundled',
  });

  expect(entry).toEqual(
    expect.objectContaining({
      fidelityClass: 'partial',
      visualEvidenceTier: 'runtime',
      visualCertification: expect.objectContaining({
        status: 'uncertified',
        measured: false,
        source: 'inferred',
        fidelityClass: 'partial',
        visualEvidenceTier: 'runtime',
        requiredBackend: 'webgpu',
        actualBackend: null,
      }),
      evidence: expect.objectContaining({
        visual: 'not-captured',
      }),
    }),
  );
});
