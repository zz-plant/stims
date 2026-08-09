import type { MilkdropCatalogEntry } from '../src/js/milkdrop/catalog-types.ts';

/**
 * A fully-populated bundled catalog entry, for tests that need a realistic
 * preset without asserting anything about parity or certification detail.
 * Override only the fields the test actually cares about.
 */

const evidence = {
  compile: 'verified',
  runtime: 'not-run',
  visual: 'not-captured',
} as const;

const semanticSupport = {
  fidelityClass: 'exact',
  evidence,
  visualEvidenceTier: 'none',
} as const;

const visualCertification = {
  status: 'uncertified',
  measured: false,
  source: 'inferred',
  fidelityClass: 'partial',
  visualEvidenceTier: 'none',
  requiredBackend: 'webgpu',
  actualBackend: null,
  reasons: ['No measured WebGPU reference capture is recorded yet.'],
} as const;

const backendSupport = {
  status: 'supported',
  reasons: [],
  evidence: [],
  requiredFeatures: [],
  unsupportedFeatures: [],
} as const;

export function makeCatalogEntry(
  overrides: Partial<MilkdropCatalogEntry> = {},
): MilkdropCatalogEntry {
  return {
    id: 'preset-alpha',
    title: 'Alpha',
    origin: 'bundled',
    tags: [],
    isFavorite: false,
    rating: 0,
    featuresUsed: [],
    warnings: [],
    supports: {
      webgl: { ...backendSupport },
      webgpu: { ...backendSupport },
    },
    fidelityClass: 'exact',
    visualEvidenceTier: 'none',
    fidelityTier: 'semantic-only',
    semanticSupport: { ...semanticSupport },
    visualCertification: { ...visualCertification },
    evidence: { ...evidence },
    certification: 'bundled',
    corpusTier: 'bundled',
    parity: {
      ignoredFields: [],
      approximatedShaderLines: [],
      missingAliasesOrFunctions: [],
      backendDivergence: [],
      visualFallbacks: [],
      blockedConstructs: [],
      blockingConstructDetails: [],
      degradationReasons: [],
      fidelityClass: 'exact',
      evidence: { ...evidence },
      visualEvidenceTier: 'none',
      semanticSupport: { ...semanticSupport },
      visualCertification: { ...visualCertification },
    },
    ...overrides,
  } as MilkdropCatalogEntry;
}
