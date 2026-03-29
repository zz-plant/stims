import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBundledCatalogFidelity } from '../scripts/check-bundled-catalog-fidelity.ts';
import { saveMeasuredVisualResultsManifest } from '../scripts/measured-visual-results.ts';
import { syncBundledCatalogFidelity } from '../scripts/sync-bundled-catalog-fidelity.ts';

function writeCatalog(repoRoot: string, document: Record<string, unknown>) {
  const catalogDir = path.join(repoRoot, 'public', 'milkdrop-presets');
  fs.mkdirSync(catalogDir, { recursive: true });
  fs.writeFileSync(
    path.join(catalogDir, 'catalog.json'),
    `${JSON.stringify(document, null, 2)}\n`,
  );
}

test('checkBundledCatalogFidelity passes for a synced catalog', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-catalog-check-'),
  );
  writeCatalog(repoRoot, {
    version: 2,
    generatedAt: '2026-03-28',
    certification: 'bundled',
    corpusTier: 'bundled',
    presets: [
      {
        id: 'synced-preset',
        title: 'Synced Preset',
        file: '/milkdrop-presets/synced-preset.milk',
        expectedFidelityClass: 'partial',
        visualEvidenceTier: 'runtime',
      },
    ],
  });
  saveMeasuredVisualResultsManifest(repoRoot, {
    version: 1,
    updatedAt: null,
    presets: [],
  });

  const result = checkBundledCatalogFidelity({ repoRoot });

  expect(result.ok).toBe(true);
});

test('checkBundledCatalogFidelity fails for optimistic catalog drift', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-catalog-check-'),
  );
  writeCatalog(repoRoot, {
    version: 2,
    generatedAt: '2026-03-28',
    certification: 'bundled',
    corpusTier: 'bundled',
    presets: [
      {
        id: 'drifted-preset',
        title: 'Drifted Preset',
        file: '/milkdrop-presets/drifted-preset.milk',
        expectedFidelityClass: 'exact',
        visualEvidenceTier: 'visual',
      },
    ],
  });
  saveMeasuredVisualResultsManifest(repoRoot, {
    version: 1,
    updatedAt: null,
    presets: [],
  });

  const result = checkBundledCatalogFidelity({ repoRoot });

  expect(result.ok).toBe(false);
  expect(result.message).toContain('parity:sync-catalog');
});

test('checkBundledCatalogFidelity passes after syncing measured visual results', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-catalog-check-'),
  );
  writeCatalog(repoRoot, {
    version: 2,
    generatedAt: '2026-03-28',
    certification: 'bundled',
    corpusTier: 'bundled',
    presets: [
      {
        id: 'measured-preset',
        title: 'Measured Preset',
        file: '/milkdrop-presets/measured-preset.milk',
        expectedFidelityClass: 'exact',
        visualEvidenceTier: 'visual',
      },
    ],
  });
  saveMeasuredVisualResultsManifest(repoRoot, {
    version: 1,
    updatedAt: '2026-03-28T12:00:00.000Z',
    presets: [
      {
        id: 'measured-preset',
        title: 'Measured Preset',
        fidelityClass: 'near-exact',
        visualEvidenceTier: 'visual',
        suiteStatus: 'pass',
        mismatchRatio: 0.01,
        threshold: 16,
        failThreshold: 0.02,
        updatedAt: '2026-03-28T12:00:00.000Z',
        sourceReport: '/tmp/measured-preset.json',
      },
    ],
  });

  syncBundledCatalogFidelity({
    repoRoot,
    generatedAt: '2026-03-28',
  });

  const result = checkBundledCatalogFidelity({ repoRoot });

  expect(result.ok).toBe(true);
});
