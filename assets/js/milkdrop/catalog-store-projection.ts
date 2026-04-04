import {
  getConservativeBundledCatalogProjectionDefaults,
  supportsFromCompiled,
} from './catalog-store-analysis';
import type { StoredMetaRecord } from './catalog-store-persistence';
import type {
  MilkdropBackendSupport,
  MilkdropBundledCatalogEntry,
  MilkdropCatalogEntry,
  MilkdropCompiledPreset,
  MilkdropPresetSource,
} from './types';

function hasBundledCompatibilityMetadata(entry: MilkdropBundledCatalogEntry) {
  return Boolean(
    entry.supports ||
      entry.expectedFidelityClass ||
      entry.visualEvidenceTier ||
      entry.semanticSupport ||
      entry.visualCertification,
  );
}

function deriveManifestEvidence({
  visualEvidenceTier,
  hasCompatibilityMetadata,
}: {
  visualEvidenceTier: MilkdropCatalogEntry['visualEvidenceTier'];
  hasCompatibilityMetadata: boolean;
}): MilkdropCatalogEntry['evidence'] {
  const compile = hasCompatibilityMetadata ? 'verified' : 'issues';
  if (visualEvidenceTier === 'visual') {
    return {
      compile,
      runtime: 'smoke-tested',
      visual: 'reference-suite',
    };
  }
  if (visualEvidenceTier === 'runtime') {
    return {
      compile,
      runtime: 'smoke-tested',
      visual: 'not-captured',
    };
  }
  return {
    compile,
    runtime: 'not-run',
    visual: 'not-captured',
  };
}

function toManifestSupport(
  backend: 'webgl' | 'webgpu',
  supported: boolean | undefined,
  hasCompatibilityMetadata: boolean,
): MilkdropBackendSupport {
  if (supported === true) {
    return {
      status: 'supported',
      reasons: [],
      evidence: [],
      requiredFeatures: [],
      unsupportedFeatures: [],
    };
  }

  if (supported === false) {
    return {
      status: 'unsupported',
      reasons: [
        `Catalog metadata marks this preset as unsupported on ${backend.toUpperCase()}.`,
      ],
      evidence: [],
      requiredFeatures: [],
      unsupportedFeatures: [],
      recommendedFallback: backend === 'webgpu' ? 'webgl' : undefined,
    };
  }

  return {
    status: 'partial',
    reasons: [
      hasCompatibilityMetadata
        ? `Detailed ${backend.toUpperCase()} compatibility is verified when this preset loads.`
        : 'Detailed compatibility is analyzed when this preset loads.',
    ],
    evidence: [],
    requiredFeatures: [],
    unsupportedFeatures: [],
    recommendedFallback: backend === 'webgpu' ? 'webgl' : undefined,
  };
}

export function toCatalogEntry(
  source: MilkdropPresetSource,
  compiled: MilkdropCompiledPreset,
  meta: StoredMetaRecord | null,
  options: {
    tags?: string[];
    curatedRank?: number;
    bundledFile?: string;
    historyIndex?: number;
    corpusTier?: MilkdropCatalogEntry['corpusTier'];
    certification?: MilkdropCatalogEntry['certification'];
    expectedFidelityClass?: MilkdropCatalogEntry['fidelityClass'];
    visualEvidenceTier?: MilkdropCatalogEntry['visualEvidenceTier'];
    semanticSupport?: MilkdropCatalogEntry['semanticSupport'];
    visualCertification?: MilkdropCatalogEntry['visualCertification'];
    evidence?: MilkdropCatalogEntry['evidence'];
  } = {},
): MilkdropCatalogEntry {
  const semanticSupport =
    options.semanticSupport ?? compiled.ir.compatibility.parity.semanticSupport;
  const visualCertification =
    options.visualCertification ??
    compiled.ir.compatibility.parity.visualCertification;
  const hasMeasuredVisualCertification =
    options.visualCertification?.measured === true;
  const bundledDefaults =
    source.origin === 'bundled' && !hasMeasuredVisualCertification
      ? getConservativeBundledCatalogProjectionDefaults(compiled)
      : null;
  return {
    id: source.id,
    title: compiled.title,
    author: compiled.author ?? source.author,
    origin: source.origin,
    tags: options.tags ?? [],
    curatedRank: options.curatedRank,
    isFavorite: Boolean(meta?.favorite),
    rating: meta?.rating ?? 0,
    lastOpenedAt: meta?.lastOpenedAt,
    updatedAt: source.updatedAt,
    historyIndex: options.historyIndex,
    featuresUsed: compiled.ir.compatibility.featureAnalysis.featuresUsed,
    warnings: compiled.ir.compatibility.warnings,
    supports: supportsFromCompiled(compiled),
    fidelityClass:
      bundledDefaults?.fidelityClass ??
      options.expectedFidelityClass ??
      visualCertification.fidelityClass,
    visualEvidenceTier:
      bundledDefaults?.visualEvidenceTier ??
      options.visualEvidenceTier ??
      visualCertification.visualEvidenceTier,
    semanticSupport,
    visualCertification:
      bundledDefaults?.visualCertification ??
      options.visualCertification ??
      visualCertification,
    evidence:
      bundledDefaults?.evidence ??
      options.evidence ??
      compiled.ir.compatibility.parity.evidence,
    certification: options.certification ?? 'exploratory',
    corpusTier: options.corpusTier ?? 'exploratory',
    parity: compiled.ir.compatibility.parity,
    bundledFile: options.bundledFile,
  };
}

export function toUnavailableBundledCatalogEntry(
  entry: MilkdropBundledCatalogEntry,
  meta: StoredMetaRecord | null,
  historyIndex: number,
): MilkdropCatalogEntry {
  return {
    id: entry.id,
    title: entry.title,
    author: entry.author,
    origin: 'bundled',
    tags: entry.tags ?? [],
    curatedRank: entry.curatedRank,
    isFavorite: Boolean(meta?.favorite),
    rating: meta?.rating ?? 0,
    lastOpenedAt: meta?.lastOpenedAt,
    updatedAt: undefined,
    historyIndex,
    featuresUsed: [],
    warnings: ['Bundled preset could not be analyzed.'],
    supports: {
      webgl: {
        status: 'partial',
        reasons: ['Bundled preset could not be analyzed.'],
        evidence: [],
        requiredFeatures: [],
        unsupportedFeatures: [],
      },
      webgpu: {
        status: 'partial',
        reasons: ['Bundled preset could not be analyzed.'],
        evidence: [],
        requiredFeatures: [],
        unsupportedFeatures: [],
        recommendedFallback: 'webgl',
      },
    },
    fidelityClass: 'fallback',
    visualEvidenceTier: 'none',
    semanticSupport: {
      fidelityClass: 'fallback',
      evidence: {
        compile: 'issues',
        runtime: 'not-run',
        visual: 'not-captured',
      },
      visualEvidenceTier: 'none',
    },
    visualCertification: {
      status: 'uncertified',
      measured: false,
      source: 'inferred',
      fidelityClass: 'fallback',
      visualEvidenceTier: 'none',
      requiredBackend: 'webgpu',
      actualBackend: null,
      reasons: ['Bundled preset could not be analyzed.'],
    },
    evidence: {
      compile: 'issues',
      runtime: 'not-run',
      visual: 'not-captured',
    },
    certification: entry.certification ?? 'bundled',
    corpusTier: entry.corpusTier ?? 'bundled',
    parity: {
      ignoredFields: [],
      approximatedShaderLines: [],
      missingAliasesOrFunctions: [],
      backendDivergence: [],
      visualFallbacks: [],
      blockedConstructs: [],
      blockingConstructDetails: [],
      degradationReasons: [
        {
          code: 'backend-unsupported',
          category: 'backend-degradation',
          message: 'Bundled preset could not be analyzed.',
          system: 'compiler',
          blocking: true,
        },
      ],
      fidelityClass: 'fallback',
      evidence: {
        compile: 'issues',
        runtime: 'not-run',
        visual: 'not-captured',
      },
      visualEvidenceTier: 'none',
      semanticSupport: {
        fidelityClass: 'fallback',
        evidence: {
          compile: 'issues',
          runtime: 'not-run',
          visual: 'not-captured',
        },
        visualEvidenceTier: 'none',
      },
      visualCertification: {
        status: 'uncertified',
        measured: false,
        source: 'inferred',
        fidelityClass: 'fallback',
        visualEvidenceTier: 'none',
        requiredBackend: 'webgpu',
        actualBackend: null,
        reasons: ['Bundled preset could not be analyzed.'],
      },
    },
    bundledFile: entry.file,
  };
}

export function toBundledCatalogEntryFromManifest(
  entry: MilkdropBundledCatalogEntry,
  meta: StoredMetaRecord | null,
  historyIndex: number,
): MilkdropCatalogEntry {
  const hasCompatibilityMetadata = hasBundledCompatibilityMetadata(entry);
  const fidelityClass =
    entry.expectedFidelityClass ??
    entry.visualCertification?.fidelityClass ??
    entry.semanticSupport?.fidelityClass ??
    'partial';
  const visualEvidenceTier =
    entry.visualEvidenceTier ??
    entry.visualCertification?.visualEvidenceTier ??
    entry.semanticSupport?.visualEvidenceTier ??
    'none';
  const evidence = deriveManifestEvidence({
    visualEvidenceTier,
    hasCompatibilityMetadata,
  });
  const semanticSupport = entry.semanticSupport ?? {
    fidelityClass,
    evidence,
    visualEvidenceTier,
  };
  const visualCertification = entry.visualCertification ?? {
    status: 'uncertified',
    measured: false,
    source: 'inferred',
    fidelityClass,
    visualEvidenceTier,
    requiredBackend: 'webgpu',
    actualBackend: null,
    reasons: hasCompatibilityMetadata
      ? []
      : ['Detailed compatibility will be analyzed when this preset loads.'],
  };
  const supports = {
    webgl: toManifestSupport(
      'webgl',
      entry.supports?.webgl,
      hasCompatibilityMetadata,
    ),
    webgpu: toManifestSupport(
      'webgpu',
      entry.supports?.webgpu,
      hasCompatibilityMetadata,
    ),
  };
  const warnings = hasCompatibilityMetadata
    ? []
    : ['Detailed compatibility will be analyzed when this preset loads.'];

  return {
    id: entry.id,
    title: entry.title,
    author: entry.author,
    origin: 'bundled',
    tags: entry.tags ?? [],
    curatedRank: entry.curatedRank,
    isFavorite: Boolean(meta?.favorite),
    rating: meta?.rating ?? 0,
    lastOpenedAt: meta?.lastOpenedAt,
    updatedAt: undefined,
    historyIndex,
    featuresUsed: [],
    warnings,
    supports,
    fidelityClass,
    visualEvidenceTier,
    semanticSupport,
    visualCertification,
    evidence,
    certification: entry.certification ?? 'bundled',
    corpusTier: entry.corpusTier ?? 'bundled',
    parity: {
      ignoredFields: [],
      approximatedShaderLines: [],
      missingAliasesOrFunctions: [],
      backendDivergence: [],
      visualFallbacks: [],
      blockedConstructs: [],
      blockingConstructDetails: [],
      degradationReasons: [],
      fidelityClass,
      evidence,
      visualEvidenceTier,
      semanticSupport,
      visualCertification,
    },
    bundledFile: entry.file,
  };
}
