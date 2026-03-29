import fs from 'node:fs';
import path from 'node:path';
import type { MilkdropBundledCatalogEntry } from '../assets/js/milkdrop/catalog-types.ts';
import type { MilkdropFidelityClass } from '../assets/js/milkdrop/common-types.ts';
import {
  loadMeasuredVisualResultsManifest,
  type MeasuredVisualPresetResult,
} from './measured-visual-results.ts';

export const BUNDLED_CATALOG_PATH = 'public/milkdrop-presets/catalog.json';

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
  if (!measuredResult) {
    return {
      ...preset,
      expectedFidelityClass: inferredCatalogFidelityWithoutMeasuredResult(),
      visualEvidenceTier: 'runtime',
    };
  }

  return {
    ...preset,
    expectedFidelityClass: measuredResult.fidelityClass,
    visualEvidenceTier: measuredResult.visualEvidenceTier,
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
