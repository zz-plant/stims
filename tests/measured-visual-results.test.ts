import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createDefaultMeasuredVisualResultsManifest,
  loadMeasuredVisualResultsManifest,
} from '../scripts/measured-visual-results.ts';
import {
  fidelityClassFromSuiteReport,
  promoteParitySuiteResult,
} from '../scripts/promote-parity-suite-result.ts';

test('creates an empty measured visual results manifest by default', () => {
  expect(createDefaultMeasuredVisualResultsManifest()).toEqual({
    version: 1,
    updatedAt: null,
    presets: [],
  });
});

test('fidelityClassFromSuiteReport maps suite results to measured fidelity', () => {
  expect(
    fidelityClassFromSuiteReport({
      presetId: 'exact-preset',
      title: 'Exact Preset',
      requiredBackend: 'webgpu',
      actualBackend: 'webgpu',
      sourceFamily: 'bundled',
      strata: ['feedback'],
      toleranceProfile: 'default',
      threshold: 16,
      failThreshold: 0.02,
      metrics: { mismatchRatio: 0 },
      status: 'pass',
    }),
  ).toBe('exact');
  expect(
    fidelityClassFromSuiteReport({
      presetId: 'near-preset',
      title: 'Near Preset',
      requiredBackend: 'webgpu',
      actualBackend: 'webgpu',
      sourceFamily: 'bundled',
      strata: ['feedback'],
      toleranceProfile: 'default',
      threshold: 16,
      failThreshold: 0.02,
      metrics: { mismatchRatio: 0.01 },
      status: 'pass',
    }),
  ).toBe('near-exact');
  expect(
    fidelityClassFromSuiteReport({
      presetId: 'fail-preset',
      title: 'Fail Preset',
      requiredBackend: 'webgpu',
      actualBackend: 'webgl',
      sourceFamily: 'bundled',
      strata: ['feedback'],
      toleranceProfile: 'default',
      threshold: 16,
      failThreshold: 0.02,
      metrics: { mismatchRatio: 0.1 },
      status: 'fail',
    }),
  ).toBe('fallback');
});

test('promoteParitySuiteResult writes measured visual results for a certified preset', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-measured-results-repo-'),
  );
  const suiteDir = path.join(repoRoot, 'screenshots', 'parity', 'suite');
  fs.mkdirSync(suiteDir, { recursive: true });
  fs.writeFileSync(
    path.join(suiteDir, 'signal-bloom.json'),
    `${JSON.stringify(
      {
        presetId: 'signal-bloom',
        title: 'Signal Bloom',
        requiredBackend: 'webgpu',
        actualBackend: 'webgpu',
        sourceFamily: 'bundled',
        strata: ['feedback', 'bundled'],
        toleranceProfile: 'default',
        threshold: 16,
        failThreshold: 0.02,
        metrics: { mismatchRatio: 0.01 },
        status: 'pass',
      },
      null,
      2,
    )}\n`,
  );

  const result = promoteParitySuiteResult({
    repoRoot,
    outputDir: path.join(repoRoot, 'screenshots', 'parity'),
    presetId: 'signal-bloom',
  });

  expect(result.entry).toEqual(
    expect.objectContaining({
      id: 'signal-bloom',
      title: 'Signal Bloom',
      fidelityClass: 'near-exact',
      visualEvidenceTier: 'visual',
      suiteStatus: 'pass',
      certificationStatus: 'certified',
      certificationReason: null,
      requiredBackend: 'webgpu',
      actualBackend: 'webgpu',
      sourceFamily: 'bundled',
      strata: ['feedback', 'bundled'],
      toleranceProfile: 'default',
      mismatchRatio: 0.01,
    }),
  );

  expect(loadMeasuredVisualResultsManifest(repoRoot).presets).toEqual([
    expect.objectContaining({
      id: 'signal-bloom',
      fidelityClass: 'near-exact',
    }),
  ]);
});
