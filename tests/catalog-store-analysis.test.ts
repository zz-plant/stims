import { expect, test } from 'bun:test';
import { getValidatedCatalogOverrides } from '../assets/js/milkdrop/catalog-store-analysis.ts';
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
      },
    ],
  );

  expect(overrides).toEqual({
    expectedFidelityClass: 'near-exact',
    visualEvidenceTier: 'visual',
    evidence: {
      ...compiled.ir.compatibility.parity.evidence,
      runtime: 'smoke-tested',
      visual: 'reference-suite',
    },
  });
});
