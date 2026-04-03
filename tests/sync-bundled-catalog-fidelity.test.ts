import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveMeasuredVisualResultsManifest } from '../scripts/measured-visual-results.ts';
import {
  inferredCatalogFidelityWithoutMeasuredResult,
  syncBundledCatalogFidelity,
  syncBundledCatalogPresetFidelity,
} from '../scripts/sync-bundled-catalog-fidelity.ts';

test('unmeasured bundled presets degrade to non-visual published fidelity', () => {
  expect(inferredCatalogFidelityWithoutMeasuredResult()).toBe('partial');

  expect(
    syncBundledCatalogPresetFidelity(
      {
        id: 'rovastar-parallel-universe',
        title: 'Rovastar - Parallel Universe',
        file: '/milkdrop-presets/rovastar-parallel-universe.milk',
        expectedFidelityClass: 'exact',
        visualEvidenceTier: 'visual',
      },
      undefined,
    ),
  ).toEqual({
    id: 'rovastar-parallel-universe',
    title: 'Rovastar - Parallel Universe',
    file: '/milkdrop-presets/rovastar-parallel-universe.milk',
    expectedFidelityClass: 'partial',
    visualEvidenceTier: 'runtime',
    visualCertification: {
      status: 'uncertified',
      measured: false,
      source: 'inferred',
      fidelityClass: 'partial',
      visualEvidenceTier: 'runtime',
      requiredBackend: 'webgpu',
      actualBackend: null,
      reasons: ['No measured WebGPU reference capture is recorded yet.'],
    },
  });
});

test('measured bundled presets keep certified visual fidelity in the published catalog', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-catalog-sync-'),
  );
  const catalogDir = path.join(repoRoot, 'public', 'milkdrop-presets');
  fs.mkdirSync(catalogDir, { recursive: true });
  fs.writeFileSync(
    path.join(catalogDir, 'catalog.json'),
    `${JSON.stringify(
      {
        version: 2,
        generatedAt: '2026-03-21',
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
          {
            id: 'unmeasured-preset',
            title: 'Unmeasured Preset',
            file: '/milkdrop-presets/unmeasured-preset.milk',
            expectedFidelityClass: 'exact',
            visualEvidenceTier: 'visual',
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

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
        certificationStatus: 'certified',
        certificationReason: null,
        requiredBackend: 'webgpu',
        actualBackend: 'webgpu',
        sourceFamily: 'bundled',
        strata: ['bundled'],
        toleranceProfile: 'default',
        mismatchRatio: 0.01,
        threshold: 16,
        failThreshold: 0.02,
        updatedAt: '2026-03-28T12:00:00.000Z',
        sourceReport: '/tmp/measured-preset.json',
      },
    ],
  });

  const result = syncBundledCatalogFidelity({
    repoRoot,
    generatedAt: '2026-03-28',
  });

  expect(result.document.generatedAt).toBe('2026-03-28');
  expect(result.document.presets).toEqual([
    expect.objectContaining({
      id: 'measured-preset',
      expectedFidelityClass: 'near-exact',
      visualEvidenceTier: 'visual',
      visualCertification: expect.objectContaining({
        status: 'certified',
        requiredBackend: 'webgpu',
        actualBackend: 'webgpu',
      }),
    }),
    expect.objectContaining({
      id: 'unmeasured-preset',
      expectedFidelityClass: 'partial',
      visualEvidenceTier: 'runtime',
      visualCertification: expect.objectContaining({
        status: 'uncertified',
        requiredBackend: 'webgpu',
      }),
    }),
  ]);
});
