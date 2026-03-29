import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CERTIFICATION_CORPUS_MANIFEST_PATH,
  loadCertificationCorpusManifest,
} from '../scripts/certification-corpus.ts';
import { loadMeasuredVisualResultsManifest } from '../scripts/measured-visual-results.ts';
import { loadVisualReferenceManifest } from '../scripts/visual-reference-manifest.ts';

type BundledCatalogDocument = {
  presets: Array<{
    id: string;
    file: string;
  }>;
};

test('certification corpus stays internally consistent and bounds the measured parity set', () => {
  const repoRoot = process.cwd();
  const manifestPath = path.join(repoRoot, CERTIFICATION_CORPUS_MANIFEST_PATH);
  const manifest = loadCertificationCorpusManifest(repoRoot);
  const bundledCatalog = JSON.parse(
    readFileSync(
      path.join(repoRoot, 'public', 'milkdrop-presets', 'catalog.json'),
      'utf8',
    ),
  ) as BundledCatalogDocument;
  const visualReferenceManifest = loadVisualReferenceManifest(repoRoot);
  const measuredResults = loadMeasuredVisualResultsManifest(repoRoot);

  expect(existsSync(manifestPath)).toBe(true);
  expect(manifest.version).toBe(1);
  expect(manifest.parityTarget).toBe('projectm-webgpu-certification-v1');
  expect(manifest.requiredBackend).toBe('webgpu');
  expect(manifest.presetCount).toBe(manifest.presets.length);

  const ids = new Set<string>();
  const groupedIds = new Map<
    keyof typeof manifest.groups,
    Array<{ id: string; file: string }>
  >();

  manifest.presets.forEach((entry) => {
    expect(ids.has(entry.id)).toBe(false);
    ids.add(entry.id);

    const absolutePath = path.join(repoRoot, entry.fixtureRoot, entry.file);
    expect(existsSync(absolutePath)).toBe(true);
    expect(entry.requiredBackend).toBe('webgpu');
    expect(entry.toleranceProfile.trim().length).toBeGreaterThan(0);
    expect(entry.strata.length).toBeGreaterThan(0);
    expect(entry.selectionReason.trim().length).toBeGreaterThan(0);

    const bucket = groupedIds.get(entry.corpusGroup) ?? [];
    bucket.push({ id: entry.id, file: entry.file });
    groupedIds.set(entry.corpusGroup, bucket);
  });

  (
    Object.entries(manifest.groups) as Array<
      [
        keyof typeof manifest.groups,
        (typeof manifest.groups)[keyof typeof manifest.groups],
      ]
    >
  ).forEach(([group, config]) => {
    expect((groupedIds.get(group) ?? []).length).toBeGreaterThanOrEqual(
      config.minimumCount,
    );
  });

  const bundledIds = bundledCatalog.presets.map((entry) => entry.id).sort();
  const bundledCorpusIds = (groupedIds.get('bundled-shipped') ?? [])
    .map((entry) => entry.id)
    .sort();
  expect(bundledCorpusIds).toEqual(bundledIds);

  const localShapeFiles = (groupedIds.get('local-custom-shape') ?? [])
    .map((entry) => entry.file)
    .sort();
  expect(localShapeFiles).toEqual(
    [
      'shape-legacy-max-slot-orbit.milk',
      'shape-projectm-dual-lattice.milk',
    ].sort(),
  );

  visualReferenceManifest.presets.forEach((entry) => {
    const corpusEntry = manifest.presets.find(
      (preset) => preset.id === entry.id,
    );
    expect(corpusEntry).toBeDefined();
    expect(corpusEntry?.requiredBackend).toBe(entry.capture.requiredBackend);
  });

  measuredResults.presets.forEach((entry) => {
    const corpusEntry = manifest.presets.find(
      (preset) => preset.id === entry.id,
    );
    expect(corpusEntry).toBeDefined();
    expect(corpusEntry?.requiredBackend).toBe(entry.requiredBackend);
  });
});
