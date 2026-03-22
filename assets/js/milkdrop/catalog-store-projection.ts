import { supportsFromCompiled } from './catalog-store-analysis';
import type { StoredMetaRecord } from './catalog-store-persistence';
import type {
  MilkdropBundledCatalogEntry,
  MilkdropCatalogEntry,
  MilkdropCompiledPreset,
  MilkdropPresetSource,
} from './types';

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
  } = {},
): MilkdropCatalogEntry {
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
      options.expectedFidelityClass ??
      compiled.ir.compatibility.parity.fidelityClass,
    visualEvidenceTier:
      options.visualEvidenceTier ??
      compiled.ir.compatibility.parity.visualEvidenceTier,
    evidence: compiled.ir.compatibility.parity.evidence,
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
    },
    bundledFile: entry.file,
  };
}
