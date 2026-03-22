import { compileMilkdropPresetSource } from './compiler';
import type {
  MilkdropBackendSupport,
  MilkdropBundledCatalogEntry,
  MilkdropCatalogEntry,
  MilkdropCompiledPreset,
  MilkdropPresetSource,
} from './types';

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
): {
  expectedFidelityClass?: MilkdropCatalogEntry['fidelityClass'];
  visualEvidenceTier?: MilkdropCatalogEntry['visualEvidenceTier'];
} {
  if (!catalogSupportsMatchCompiled(entry, compiled)) {
    return {};
  }

  const overrides: {
    expectedFidelityClass?: MilkdropCatalogEntry['fidelityClass'];
    visualEvidenceTier?: MilkdropCatalogEntry['visualEvidenceTier'];
  } = {};

  if (
    entry.expectedFidelityClass ===
    compiled.ir.compatibility.parity.fidelityClass
  ) {
    overrides.expectedFidelityClass = entry.expectedFidelityClass;
  }

  if (
    entry.visualEvidenceTier ===
    compiled.ir.compatibility.parity.visualEvidenceTier
  ) {
    overrides.visualEvidenceTier = entry.visualEvidenceTier;
  }

  return overrides;
}

export function createCatalogAnalysis() {
  const analysisCache = new Map<string, MilkdropCompiledPreset>();
  const analysisOptionsKey = 'compat';

  const getCompiled = (source: MilkdropPresetSource) => {
    const cacheKey = `${analysisOptionsKey}:${source.id}:${source.updatedAt ?? 0}:${source.raw}`;
    const cached = analysisCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const compiled = compileMilkdropPresetSource(source.raw, source);
    analysisCache.set(cacheKey, compiled);
    return compiled;
  };

  return {
    getCompiled,
  };
}
