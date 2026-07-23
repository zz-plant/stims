import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createDefaultMeasuredVisualResultsManifest,
  loadMeasuredVisualResultsManifest,
  saveMeasuredVisualResultsManifest,
  validateMeasuredVisualResultsManifest,
} from '../../scripts/measured-visual-results.ts';
import { buildNativeProjectMReferenceMetadata } from '../../scripts/native-projectm-reference.ts';
import { hashFileSha256 } from '../../scripts/parity-artifacts.ts';
import {
  fidelityClassFromSuiteReport,
  promoteParitySuiteResult,
} from '../../scripts/promote-parity-suite-result.ts';
import { saveVisualReferenceManifest } from '../../scripts/visual-reference-manifest.ts';

function writeProjectmReferenceManifest(repoRoot: string, presetId: string) {
  const fixtureRoot = path.join(
    repoRoot,
    'tests/fixtures/milkdrop/projectm-reference',
  );
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const imagePath = path.join(fixtureRoot, `${presetId}.png`);
  const metadataPath = path.join(
    fixtureRoot,
    `${presetId}.native-projectm.json`,
  );
  const presetPath = path.join(
    repoRoot,
    'tests/fixtures/milkdrop/projectm-upstream',
    `${presetId}.milk`,
  );
  const harnessPath = path.join(
    repoRoot,
    'scripts/native-projectm-capture.cpp',
  );
  fs.mkdirSync(path.dirname(presetPath), { recursive: true });
  fs.mkdirSync(path.dirname(harnessPath), { recursive: true });
  fs.writeFileSync(presetPath, `[preset00]\nname=${presetId}\n`);
  fs.writeFileSync(harnessPath, '// native projectM harness\n');
  fs.writeFileSync(imagePath, 'fixture-image');
  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify(
      buildNativeProjectMReferenceMetadata({
        presetId,
        presetPath,
        presetSha256: hashFileSha256(presetPath),
        imageSha256: hashFileSha256(imagePath),
        width: 1,
        height: 1,
        fps: 60,
        frameCount: 300,
        projectmVersion: '3.1.12',
        projectmPrefix: '/opt/homebrew/opt/projectm',
        libraryPath: '/opt/homebrew/opt/projectm/lib/libprojectM.dylib',
        librarySha256: 'b'.repeat(64),
        harnessSha256: hashFileSha256(harnessPath),
        createdAt: '2026-07-16T00:00:00.000Z',
        platform: 'darwin',
        arch: 'arm64',
      }),
      null,
      2,
    )}\n`,
  );
  saveVisualReferenceManifest(repoRoot, {
    version: 1,
    parityTarget: 'projectm-visual-reference',
    fixtureRoot: 'tests/fixtures/milkdrop/projectm-reference',
    minimumPresetCount: 0,
    presetCount: 1,
    defaults: {
      renderer: 'projectm',
      requiredBackend: 'webgpu',
      width: 1,
      height: 1,
      warmupMs: 5000,
      captureOffsetMs: 0,
      toleranceProfile: 'default',
      threshold: 16,
      failThreshold: 0.02,
    },
    presets: [
      {
        id: presetId,
        title: 'Signal Bloom',
        image: `${presetId}.png`,
        metadata: `${presetId}.native-projectm.json`,
        sourceFamily: 'bundled',
        strata: ['feedback', 'bundled'],
        tolerance: {
          profile: 'default',
          threshold: 16,
          failThreshold: 0.02,
        },
        capture: {
          renderer: 'projectm',
          requiredBackend: 'webgpu',
          width: 1,
          height: 1,
          warmupMs: 5000,
          captureOffsetMs: 0,
        },
        provenance: {
          label: 'projectM fixture',
          importedAt: '2026-03-28T00:00:00.000Z',
        },
      },
    ],
  });
  return {
    imagePath,
    imageSha256: hashFileSha256(imagePath),
    metadataPath,
    metadataSha256: hashFileSha256(metadataPath),
  };
}

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
  const projectmReference = writeProjectmReferenceManifest(
    repoRoot,
    'signal-bloom',
  );
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
        projectmReference,
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

  const staleReport = JSON.parse(
    fs.readFileSync(path.join(suiteDir, 'signal-bloom.json'), 'utf8'),
  );
  staleReport.projectmReference.imageSha256 = 'f'.repeat(64);
  fs.writeFileSync(
    path.join(suiteDir, 'signal-bloom.json'),
    `${JSON.stringify(staleReport)}\n`,
  );
  expect(() =>
    promoteParitySuiteResult({
      repoRoot,
      outputDir: path.join(repoRoot, 'screenshots', 'parity'),
      presetId: 'signal-bloom',
    }),
  ).toThrow('current native projectM reference identity');
});

test('promoteParitySuiteResult rejects a pass report without projectM evidence', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-measured-results-no-projectm-'),
  );
  const suiteDir = path.join(repoRoot, 'screenshots', 'parity', 'suite');
  fs.mkdirSync(suiteDir, { recursive: true });
  fs.writeFileSync(
    path.join(suiteDir, 'self-reference.json'),
    `${JSON.stringify({
      presetId: 'self-reference',
      title: 'Self Reference',
      requiredBackend: 'webgpu',
      actualBackend: 'webgpu',
      sourceFamily: 'bundled',
      strata: ['feedback'],
      toleranceProfile: 'default',
      threshold: 16,
      failThreshold: 0.02,
      metrics: { mismatchRatio: 0.01 },
      status: 'pass',
    })}\n`,
  );

  expect(() =>
    promoteParitySuiteResult({
      repoRoot,
      outputDir: path.join(repoRoot, 'screenshots', 'parity'),
      presetId: 'self-reference',
    }),
  ).toThrow('does not have a projectM reference');
});

test('validateMeasuredVisualResultsManifest checks source report provenance', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-measured-results-validate-'),
  );
  const suiteDir = path.join(repoRoot, 'screenshots', 'parity', 'suite');
  fs.mkdirSync(suiteDir, { recursive: true });
  const validProjectmReference = writeProjectmReferenceManifest(
    repoRoot,
    'valid-preset',
  );

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
        projectmReference: validProjectmReference,
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
        title: 'Mismatch Preset',
        requiredBackend: 'webgpu',
        actualBackend: 'webgpu',
        sourceFamily: 'bundled',
        strata: ['feedback'],
        toleranceProfile: 'default',
        threshold: 16,
        failThreshold: 0.02,
        metrics: { mismatchRatio: 0.4 },
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
