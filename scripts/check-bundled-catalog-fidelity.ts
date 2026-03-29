import fs from 'node:fs';
import path from 'node:path';
import {
  loadMeasuredVisualResultsManifest,
  type MeasuredVisualPresetResult,
} from './measured-visual-results.ts';
import {
  BUNDLED_CATALOG_PATH,
  buildSyncedBundledCatalogDocument,
} from './sync-bundled-catalog-fidelity.ts';

type CheckBundledCatalogFidelityResult = {
  ok: boolean;
  catalogPath: string;
  message: string;
};

type BundledCatalogDocument = {
  version: number;
  generatedAt: string;
  certification?: 'bundled' | 'certified' | 'exploratory';
  corpusTier?: 'bundled' | 'certified' | 'exploratory';
  presets: Array<Record<string, unknown>>;
};

export function checkBundledCatalogFidelity({
  repoRoot,
  measuredResults,
}: {
  repoRoot: string;
  measuredResults?: readonly MeasuredVisualPresetResult[];
}): CheckBundledCatalogFidelityResult {
  const catalogPath = path.join(repoRoot, BUNDLED_CATALOG_PATH);
  const currentDocument = JSON.parse(
    fs.readFileSync(catalogPath, 'utf8'),
  ) as BundledCatalogDocument;
  const effectiveMeasuredResults =
    measuredResults ?? loadMeasuredVisualResultsManifest(repoRoot).presets;
  const expectedDocument = buildSyncedBundledCatalogDocument({
    document: currentDocument,
    measuredResults: effectiveMeasuredResults,
    generatedAt: currentDocument.generatedAt,
  });

  if (
    JSON.stringify(currentDocument, null, 2) ===
    JSON.stringify(expectedDocument, null, 2)
  ) {
    return {
      ok: true,
      catalogPath,
      message: `Bundled catalog fidelity is synced: ${catalogPath}`,
    };
  }

  return {
    ok: false,
    catalogPath,
    message: [
      `Bundled catalog fidelity is out of sync: ${catalogPath}`,
      'Run `bun run parity:sync-catalog` to regenerate it from measured results.',
    ].join('\n'),
  };
}

if (import.meta.main) {
  const result = checkBundledCatalogFidelity({
    repoRoot: process.cwd(),
  });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}
