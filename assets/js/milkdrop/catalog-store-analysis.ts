import measuredResultsJson from '../../data/milkdrop-parity/measured-results.json' with {
  type: 'json',
};
import { compileMilkdropPresetSource } from './compiler';
import type {
  MilkdropBackendSupport,
  MilkdropBundledCatalogEntry,
  MilkdropCatalogEntry,
  MilkdropCompiledPreset,
  MilkdropPresetSource,
} from './types';

type MeasuredVisualPresetResult = {
  id: string;
  fidelityClass: MilkdropCatalogEntry['fidelityClass'];
  visualEvidenceTier: Extract<
    MilkdropCatalogEntry['visualEvidenceTier'],
    'visual'
  >;
  suiteStatus: 'pass' | 'fail' | 'backend-mismatch';
  certificationStatus: 'certified' | 'uncertified';
  certificationReason: string | null;
  requiredBackend: 'webgl' | 'webgpu';
  actualBackend: 'webgl' | 'webgpu' | null;
};

type MeasuredVisualResultsManifest = {
  version: number;
  updatedAt: string | null;
  presets: MeasuredVisualPresetResult[];
};

const MEASURED_VISUAL_RESULTS =
  measuredResultsJson as MeasuredVisualResultsManifest;

function inferredFidelityWithoutMeasuredVisualResult(
  compiled: MilkdropCompiledPreset,
): MilkdropCatalogEntry['fidelityClass'] {
  switch (compiled.ir.compatibility.parity.fidelityClass) {
    case 'fallback':
      return 'fallback';
    case 'partial':
      return 'partial';
    case 'near-exact':
    case 'exact':
      return 'partial';
  }
}

function buildInferredVisualCertificationWithoutMeasuredResult(
  compiled: MilkdropCompiledPreset,
): MilkdropCatalogEntry['visualCertification'] {
  const inferredFidelityClass =
    inferredFidelityWithoutMeasuredVisualResult(compiled);
  const inferredVisualEvidenceTier =
    compiled.ir.compatibility.parity.visualEvidenceTier === 'visual'
      ? 'runtime'
      : compiled.ir.compatibility.parity.visualEvidenceTier;

  return {
    status: 'uncertified',
    measured: false,
    source: 'inferred',
    fidelityClass: inferredFidelityClass,
    visualEvidenceTier: inferredVisualEvidenceTier,
    requiredBackend: 'webgpu',
    actualBackend: null,
    reasons: ['No measured WebGPU reference capture is recorded yet.'],
  };
}

function inferredVisualEvidenceWithoutMeasuredResult(
  compiled: MilkdropCompiledPreset,
): {
  visualEvidenceTier: MilkdropCatalogEntry['visualEvidenceTier'];
  evidence: MilkdropCatalogEntry['evidence'];
} {
  const parity = compiled.ir.compatibility.parity;
  return {
    visualEvidenceTier:
      parity.visualEvidenceTier === 'visual'
        ? 'runtime'
        : parity.visualEvidenceTier,
    evidence: {
      ...parity.evidence,
      visual: 'not-captured',
    },
  };
}

function inferredVisualCertificationWithoutMeasuredResult(
  compiled: MilkdropCompiledPreset,
): MilkdropCatalogEntry['visualCertification'] {
  return (
    compiled.ir.compatibility.parity.visualCertification ??
    buildInferredVisualCertificationWithoutMeasuredResult(compiled)
  );
}

export function supportsFromCompiled(compiled: MilkdropCompiledPreset): {
  webgl: MilkdropBackendSupport;
  webgpu: MilkdropBackendSupport;
} {
  return {
    webgl: compiled.ir.compatibility.backends.webgl,
    webgpu: compiled.ir.compatibility.backends.webgpu,
  };
}

function supportFlagMatchesCompiled(
  status: MilkdropBackendSupport['status'],
  flag: boolean | undefined,
) {
  if (typeof flag !== 'boolean') {
    return true;
  }

  return flag ? status === 'supported' : status !== 'supported';
}

function catalogSupportsMatchCompiled(
  entry: MilkdropBundledCatalogEntry,
  compiled: MilkdropCompiledPreset,
) {
  const catalogSupports = entry.supports;
  if (!catalogSupports) {
    return true;
  }

  const compiledSupports = supportsFromCompiled(compiled);
  return (
    supportFlagMatchesCompiled(
      compiledSupports.webgl.status,
      catalogSupports.webgl,
    ) &&
    supportFlagMatchesCompiled(
      compiledSupports.webgpu.status,
      catalogSupports.webgpu,
    )
  );
}

export function getValidatedCatalogOverrides(
  entry: MilkdropBundledCatalogEntry,
  compiled: MilkdropCompiledPreset,
  measuredResults: readonly MeasuredVisualPresetResult[] = MEASURED_VISUAL_RESULTS.presets,
): {
  expectedFidelityClass?: MilkdropCatalogEntry['fidelityClass'];
  visualEvidenceTier?: MilkdropCatalogEntry['visualEvidenceTier'];
  evidence?: MilkdropCatalogEntry['evidence'];
  semanticSupport?: MilkdropCatalogEntry['semanticSupport'];
  visualCertification?: MilkdropCatalogEntry['visualCertification'];
} {
  const measuredResult = measuredResults.find(
    (preset) => preset.id === entry.id,
  );
  if (measuredResult) {
    return {
      expectedFidelityClass: measuredResult.fidelityClass,
      visualEvidenceTier: measuredResult.visualEvidenceTier,
      evidence: {
        ...compiled.ir.compatibility.parity.evidence,
        runtime: 'smoke-tested',
        visual: 'reference-suite',
      },
      semanticSupport: compiled.ir.compatibility.parity.semanticSupport ?? {
        fidelityClass: compiled.ir.compatibility.parity.fidelityClass,
        evidence: compiled.ir.compatibility.parity.evidence,
        visualEvidenceTier: compiled.ir.compatibility.parity.visualEvidenceTier,
      },
      visualCertification: {
        status: measuredResult.certificationStatus,
        measured: true,
        source: 'reference-suite',
        fidelityClass: measuredResult.fidelityClass,
        visualEvidenceTier: measuredResult.visualEvidenceTier,
        requiredBackend: measuredResult.requiredBackend,
        actualBackend: measuredResult.actualBackend,
        reasons: measuredResult.certificationReason
          ? [measuredResult.certificationReason]
          : [],
      },
    };
  }

  const inferredVisual = inferredVisualEvidenceWithoutMeasuredResult(compiled);
  const overrides: {
    expectedFidelityClass?: MilkdropCatalogEntry['fidelityClass'];
    visualEvidenceTier?: MilkdropCatalogEntry['visualEvidenceTier'];
    evidence?: MilkdropCatalogEntry['evidence'];
    semanticSupport?: MilkdropCatalogEntry['semanticSupport'];
    visualCertification?: MilkdropCatalogEntry['visualCertification'];
  } = {
    expectedFidelityClass:
      inferredFidelityWithoutMeasuredVisualResult(compiled),
    visualEvidenceTier: inferredVisual.visualEvidenceTier,
    evidence: inferredVisual.evidence,
    semanticSupport: compiled.ir.compatibility.parity.semanticSupport ?? {
      fidelityClass: compiled.ir.compatibility.parity.fidelityClass,
      evidence: compiled.ir.compatibility.parity.evidence,
      visualEvidenceTier: compiled.ir.compatibility.parity.visualEvidenceTier,
    },
    visualCertification:
      inferredVisualCertificationWithoutMeasuredResult(compiled),
  };

  if (!catalogSupportsMatchCompiled(entry, compiled)) {
    return overrides;
  }

  if (
    entry.expectedFidelityClass ===
    compiled.ir.compatibility.parity.fidelityClass
  ) {
    overrides.expectedFidelityClass =
      inferredFidelityWithoutMeasuredVisualResult(compiled);
  }

  if (
    entry.visualEvidenceTier ===
    compiled.ir.compatibility.parity.visualEvidenceTier
  ) {
    overrides.visualEvidenceTier = inferredVisual.visualEvidenceTier;
  }

  return overrides;
}

export function getConservativeBundledCatalogProjectionDefaults(
  compiled: MilkdropCompiledPreset,
): Pick<
  MilkdropCatalogEntry,
  'fidelityClass' | 'visualEvidenceTier' | 'visualCertification' | 'evidence'
> {
  const visualEvidenceTier =
    inferredVisualEvidenceWithoutMeasuredResult(compiled);

  return {
    fidelityClass: inferredFidelityWithoutMeasuredVisualResult(compiled),
    visualEvidenceTier: visualEvidenceTier.visualEvidenceTier,
    visualCertification:
      buildInferredVisualCertificationWithoutMeasuredResult(compiled),
    evidence: visualEvidenceTier.evidence,
  };
}

export function createCatalogAnalysis() {
  const analysisCache = new Map<string, MilkdropCompiledPreset>();
  const analysisById = new Map<string, MilkdropCompiledPreset>();
  const analysisOptionsKey = 'compat';

  const getCompiled = (source: MilkdropPresetSource) => {
    const cacheKey = `${analysisOptionsKey}:${source.id}:${source.updatedAt ?? 0}:${source.raw}`;
    const cached = analysisCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const compiled = compileMilkdropPresetSource(source.raw, source);
    analysisCache.set(cacheKey, compiled);
    analysisById.set(source.id, compiled);
    return compiled;
  };

  return {
    getCompiled,
    getCachedCompiled(id: string) {
      return analysisById.get(id) ?? null;
    },
  };
}
