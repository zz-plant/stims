import fs from 'node:fs';
import path from 'node:path';
import type { MilkdropBundledCatalogEntry } from '../assets/js/milkdrop/catalog-types.ts';
import type {
  MilkdropFidelityClass,
  MilkdropVisualCertification,
} from '../assets/js/milkdrop/common-types.ts';
import {
  loadMeasuredVisualResultsManifest,
  type MeasuredVisualPresetResult,
} from './measured-visual-results.ts';

export const BUNDLED_CATALOG_PATH = 'public/milkdrop-presets/catalog.json';

type ShaderDependentPresetOverride = {
  reason: string;
};

const SHADER_DEPENDENT_PRESET_OVERRIDES = new Map<
  string,
  ShaderDependentPresetOverride
>([
  [
    'martin-anandamide-mandelbox-explorer-quantum-timepiece-remix',
    {
      reason:
        'Embedded shader text uses previous-frame/noise samplers plus GLSL constructs that Stims cannot execute directly yet.',
    },
  ],
  [
    'martin-elusive-impressions-mix2-flacc-mess-proph-nz-2',
    {
      reason:
        'Embedded shader text uses noise-volume, blur, and main samplers that require native shader-text compatibility.',
    },
  ],
  [
    'martin-city-of-shadows',
    {
      reason:
        'Embedded shader text depends on packed previous-frame and noise sampler reads that are not directly executable yet.',
    },
  ],
  [
    'martin-tunnel-race',
    {
      reason:
        'Embedded shader text uses GLSL matrix/vector/texture constructs that are not supported by the current MilkDrop expression runtime.',
    },
  ],
  [
    'martin-castle-in-the-air',
    {
      reason:
        'Embedded shader text depends on blur, noise, and previous-frame samplers that need a shader-text compatibility path.',
    },
  ],
]);

function buildShaderDependentVisualCertification(
  override: ShaderDependentPresetOverride,
): MilkdropVisualCertification {
  return {
    status: 'uncertified',
    measured: false,
    source: 'inferred',
    fidelityClass: 'fallback',
    visualEvidenceTier: 'compile',
    requiredBackend: 'webgpu',
    actualBackend: null,
    reasons: [
      override.reason,
      'Needs native shader-text sampler/uniform translation or a certified compatibility renderer before it can be marked supported.',
    ],
  };
}

function applyShaderDependentPresetOverride(
  preset: MilkdropBundledCatalogEntry,
): MilkdropBundledCatalogEntry | null {
  const override = SHADER_DEPENDENT_PRESET_OVERRIDES.get(preset.id);
  if (!override) {
    return null;
  }

  return {
    ...preset,
    tags: Array.from(
      new Set([
        ...(preset.tags ?? []),
        'shader-text-dependent',
        'compatibility-fallback',
      ]),
    ),
    supports: { webgl: false, webgpu: false },
    expectedFidelityClass: 'fallback',
    visualEvidenceTier: 'compile',
    visualCertification: buildShaderDependentVisualCertification(override),
  };
}

export type BundledCatalogDocument = {
  version: number;
  generatedAt: string;
  certification?: 'bundled' | 'certified' | 'exploratory';
  corpusTier?: 'bundled' | 'certified' | 'exploratory';
  presets: MilkdropBundledCatalogEntry[];
};

export function inferredCatalogFidelityWithoutMeasuredResult(): MilkdropFidelityClass {
  return 'partial';
}

export function syncBundledCatalogPresetFidelity(
  preset: MilkdropBundledCatalogEntry,
  measuredResult: MeasuredVisualPresetResult | undefined,
): MilkdropBundledCatalogEntry {
  const shaderDependentOverride = applyShaderDependentPresetOverride(preset);
  if (shaderDependentOverride) {
    return shaderDependentOverride;
  }

  if (!measuredResult) {
    return {
      ...preset,
      expectedFidelityClass: inferredCatalogFidelityWithoutMeasuredResult(),
      visualEvidenceTier: 'runtime',
      visualCertification: {
        status: 'uncertified',
        measured: false,
        source: 'inferred',
        fidelityClass: inferredCatalogFidelityWithoutMeasuredResult(),
        visualEvidenceTier: 'runtime',
        requiredBackend: 'webgpu',
        actualBackend: null,
        reasons: ['No measured WebGPU reference capture is recorded yet.'],
      },
    };
  }

  return {
    ...preset,
    expectedFidelityClass: measuredResult.fidelityClass,
    visualEvidenceTier: measuredResult.visualEvidenceTier,
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

export function buildSyncedBundledCatalogDocument({
  document,
  measuredResults,
  generatedAt,
}: {
  document: BundledCatalogDocument;
  measuredResults: readonly MeasuredVisualPresetResult[];
  generatedAt: string;
}): BundledCatalogDocument {
  const measuredById = new Map(
    measuredResults.map((preset) => [preset.id, preset]),
  );
  return {
    ...document,
    generatedAt,
    presets: document.presets.map((preset) =>
      syncBundledCatalogPresetFidelity(preset, measuredById.get(preset.id)),
    ),
  };
}

export function syncBundledCatalogFidelity({
  repoRoot,
  generatedAt = new Date().toISOString().slice(0, 10),
}: {
  repoRoot: string;
  generatedAt?: string;
}) {
  const catalogPath = path.join(repoRoot, BUNDLED_CATALOG_PATH);
  const document = JSON.parse(
    fs.readFileSync(catalogPath, 'utf8'),
  ) as BundledCatalogDocument;
  const measuredResults = loadMeasuredVisualResultsManifest(repoRoot);
  const nextDocument = buildSyncedBundledCatalogDocument({
    document,
    measuredResults: measuredResults.presets,
    generatedAt,
  });

  fs.writeFileSync(catalogPath, `${JSON.stringify(nextDocument, null, 2)}\n`);
  return {
    catalogPath,
    document: nextDocument,
  };
}

function usage() {
  console.error(
    'Usage: bun scripts/sync-bundled-catalog-fidelity.ts [--generated-at YYYY-MM-DD]',
  );
}

function parseArgs(argv: string[]) {
  const generatedAtIndex = argv.indexOf('--generated-at');
  if (generatedAtIndex === -1) {
    return {
      repoRoot: process.cwd(),
      generatedAt: undefined,
    };
  }

  if (generatedAtIndex + 1 >= argv.length) {
    return null;
  }

  return {
    repoRoot: process.cwd(),
    generatedAt: argv[generatedAtIndex + 1],
  };
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    usage();
    process.exit(1);
  }

  try {
    const result = syncBundledCatalogFidelity(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
