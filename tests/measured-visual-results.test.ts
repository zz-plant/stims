import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createDefaultMeasuredVisualResultsManifest,
  loadMeasuredVisualResultsManifest,
  saveMeasuredVisualResultsManifest,
  validateMeasuredVisualResultsManifest,
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

test('validateMeasuredVisualResultsManifest checks source report provenance', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-measured-results-validate-'),
  );
  const suiteDir = path.join(repoRoot, 'screenshots', 'parity', 'suite');
  fs.mkdirSync(suiteDir, { recursive: true });

  const validReportPath = path.join(suiteDir, 'valid-preset.json');
  fs.writeFileSync(
    validReportPath,
    `${JSON.stringify(
      {
        presetId: 'valid-preset',
        title: 'Valid Preset',
        requiredBackend: 'webgpu',
        actualBackend: 'webgpu',
        sourceFamily: 'bundled',
        strata: ['feedback'],
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

  const mismatchedReportPath = path.join(suiteDir, 'mismatch-preset.json');
  fs.writeFileSync(
    mismatchedReportPath,
    `${JSON.stringify(
      {
        presetId: 'mismatch-preset',
        title: 'Wrong Title',
        requiredBackend: 'webgl',
        actualBackend: 'webgl',
        sourceFamily: 'bundled',
        strata: ['feedback'],
        toleranceProfile: 'default',
        threshold: 16,
        failThreshold: 0.02,
        metrics: { mismatchRatio: 0.5 },
        status: 'fail',
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
        id: 'valid-preset',
        title: 'Valid Preset',
        fidelityClass: 'near-exact',
        visualEvidenceTier: 'visual',
        suiteStatus: 'pass',
        certificationStatus: 'certified',
        certificationReason: null,
        requiredBackend: 'webgpu',
        actualBackend: 'webgpu',
        sourceFamily: 'bundled',
        strata: ['feedback'],
        toleranceProfile: 'default',
        mismatchRatio: 0.01,
        threshold: 16,
        failThreshold: 0.02,
        updatedAt: '2026-03-28T12:00:00.000Z',
        sourceReport: path.relative(repoRoot, validReportPath),
      },
      {
        id: 'missing-source-report',
        title: 'Missing Source Report',
        fidelityClass: 'fallback',
        visualEvidenceTier: 'visual',
        suiteStatus: 'fail',
        certificationStatus: 'uncertified',
        certificationReason:
          'Measured visual parity did not pass the certification gate.',
        requiredBackend: 'webgpu',
        actualBackend: 'webgpu',
        sourceFamily: 'bundled',
        strata: ['feedback'],
        toleranceProfile: 'default',
        mismatchRatio: 0.5,
        threshold: 16,
        failThreshold: 0.02,
        updatedAt: '2026-03-28T12:00:00.000Z',
        sourceReport: 'screenshots/parity/suite/missing-source-report.json',
      },
      {
        id: 'mismatch-preset',
        title: 'Mismatch Preset',
        fidelityClass: 'fallback',
        visualEvidenceTier: 'visual',
        suiteStatus: 'fail',
        certificationStatus: 'uncertified',
        certificationReason:
          'Measured visual parity did not pass the certification gate.',
        requiredBackend: 'webgpu',
        actualBackend: 'webgpu',
        sourceFamily: 'bundled',
        strata: ['feedback'],
        toleranceProfile: 'default',
        mismatchRatio: 0.5,
        threshold: 16,
        failThreshold: 0.02,
        updatedAt: '2026-03-28T12:00:00.000Z',
        sourceReport: path.relative(repoRoot, mismatchedReportPath),
      },
    ],
  });

  const validation = validateMeasuredVisualResultsManifest(repoRoot);

  expect(validation.ok).toBe(false);
  expect(validation.missingSourceReportCount).toBe(1);
  expect(validation.mismatchedSourceReportCount).toBe(1);
  expect(validation.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        presetId: 'missing-source-report',
        reason: 'missing-source-report-file',
      }),
      expect.objectContaining({
        presetId: 'mismatch-preset',
        reason: 'report-fidelity-mismatch',
      }),
    ]),
  );
});
