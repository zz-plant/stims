import { expect, test } from 'bun:test';
import {
  deriveFidelityTier,
  getValidatedCatalogOverrides,
} from '../../assets/js/milkdrop/catalog-store-analysis.ts';
import { toCatalogEntry } from '../../assets/js/milkdrop/catalog-store-projection.ts';
import { compileMilkdropPresetSource } from '../../assets/js/milkdrop/compiler.ts';
import {
  fidelityTierLabel,
  supportLabel,
} from '../../assets/js/milkdrop/overlay/preset-row.ts';

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
        mismatchRatio: null,
        failThreshold: null,
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

test('deriveFidelityTier does not promote reference-only presets without a measured result', () => {
  expect(deriveFidelityTier('100-square')).toBe('unmeasured');
});

test('deriveFidelityTier returns measured-checksum for a parity-corpus preset with baseline checksums', () => {
  expect(deriveFidelityTier('parity-feedback-01')).toBe('measured-checksum');
  expect(deriveFidelityTier('parity-hybrid-08')).toBe('measured-checksum');
});

test('deriveFidelityTier returns unmeasured for a preset without any evidence', () => {
  expect(deriveFidelityTier('unknown-local-fixture')).toBe('unmeasured');
  expect(deriveFidelityTier('random-ad-hoc-preset')).toBe('unmeasured');
});

test('deriveFidelityTier returns semantic-only when the compiler can parse but no evidence exists', () => {
  expect(
    deriveFidelityTier('some-compilable-preset', { isCompiled: true }),
  ).toBe('semantic-only');
});

test('an unmeasured preset shows as "Unmeasured" not "Supported"', () => {
  expect(fidelityTierLabel('unmeasured')).toBe('Unmeasured');
  expect(fidelityTierLabel('unmeasured')).not.toBe('Supported');
  expect(supportLabel('supported')).toBe('Supported');
  expect(fidelityTierLabel('unmeasured')).not.toBe(supportLabel('supported'));
});
