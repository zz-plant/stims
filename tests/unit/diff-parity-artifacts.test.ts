import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  computeParityDiffMetrics,
  diffParityArtifacts,
  loadImagePixels,
} from '../../scripts/diff-parity-artifacts.ts';
import {
  appendParityArtifactEntry,
  loadParityArtifactManifest,
} from '../../scripts/parity-artifacts.ts';
import {
  compareSuiteResults,
  type SuitePresetResult,
  suiteResultRank,
} from '../../scripts/run-parity-diff-suite.ts';

test('computeParityDiffMetrics reports exact matches', () => {
  const pixelData = Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255]);

  const { metrics } = computeParityDiffMetrics({
    stims: { width: 2, height: 1, channels: 4, data: pixelData },
    projectm: { width: 2, height: 1, channels: 4, data: pixelData },
    threshold: 0,
  });

  expect(metrics.exactMatch).toBe(true);
  expect(metrics.mismatchedPixels).toBe(0);
  expect(metrics.mismatchRatio).toBe(0);
});

test('computeParityDiffMetrics counts mismatched pixels above threshold', () => {
  const { metrics } = computeParityDiffMetrics({
    stims: {
      width: 1,
      height: 1,
      channels: 4,
      data: Uint8Array.from([0, 0, 0, 255]),
    },
    projectm: {
      width: 1,
      height: 1,
      channels: 4,
      data: Uint8Array.from([32, 0, 0, 255]),
    },
    threshold: 16,
  });

  expect(metrics.exactMatch).toBe(false);
  expect(metrics.mismatchedPixels).toBe(1);
  expect(metrics.maxChannelDelta).toBe(32);
});

test('diffParityArtifacts resolves the latest pair for a preset and writes outputs', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stims-parity-diff-'));
  const stimsImagePath = path.join(tempDir, 'stims.png');
  const projectmImagePath = path.join(tempDir, 'projectm.png');

  await sharp({
    create: {
      width: 2,
      height: 1,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toFile(stimsImagePath);
  await sharp({
    create: {
      width: 2,
      height: 1,
      channels: 4,
      background: { r: 8, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toFile(projectmImagePath);

  appendParityArtifactEntry(tempDir, {
    kind: 'stims-capture',
    slug: 'milkdrop',
    presetId: 'signal-bloom',
    createdAt: '2026-03-28T15:04:05.000Z',
    files: { image: stimsImagePath },
  });
  appendParityArtifactEntry(tempDir, {
    kind: 'projectm-reference',
    slug: 'milkdrop',
    presetId: 'signal-bloom',
    createdAt: '2026-03-28T15:05:05.000Z',
    files: { image: projectmImagePath },
  });

  const result = await diffParityArtifacts({
    outputDir: tempDir,
    presetId: 'signal-bloom',
    threshold: 0,
    writeDiff: true,
  });

  expect(fs.existsSync(result.reportPath)).toBe(true);
  expect(
    result.diffImagePath ? fs.existsSync(result.diffImagePath) : false,
  ).toBe(true);
  expect(result.metrics.mismatchedPixels).toBeGreaterThan(0);
  expect(
    loadParityArtifactManifest(tempDir).artifacts.some(
      (entry) => entry.kind === 'parity-diff',
    ),
  ).toBe(true);
});

function makeSuiteResult(
  overrides: Partial<SuitePresetResult> & { presetId: string },
): SuitePresetResult {
  return {
    projectmImagePath: '',
    requiredBackend: 'webgpu',
    actualBackend: null,
    stimsArtifactId: null,
    ...overrides,
    title: overrides.title ?? `title-${overrides.presetId}`,
    status: overrides.status ?? 'pass',
    mismatchRatio: overrides.mismatchRatio ?? null,
    reportPath: overrides.reportPath ?? null,
    diffImagePath: overrides.diffImagePath ?? null,
  };
}

test('compareSuiteResults sorts worst-first by status rank, then highest mismatch first', () => {
  const entries: SuitePresetResult[] = [
    makeSuiteResult({ presetId: 'a', status: 'pass', mismatchRatio: 0.01 }),
    makeSuiteResult({ presetId: 'b', status: 'fail', mismatchRatio: 0.15 }),
    makeSuiteResult({ presetId: 'c', status: 'fail', mismatchRatio: 0.25 }),
    makeSuiteResult({
      presetId: 'd',
      status: 'backend-mismatch',
      mismatchRatio: null,
    }),
    makeSuiteResult({
      presetId: 'e',
      status: 'missing-stims-capture',
      mismatchRatio: null,
    }),
    makeSuiteResult({ presetId: 'f', status: 'pass', mismatchRatio: 0.0 }),
    makeSuiteResult({ presetId: 'g', status: 'error', mismatchRatio: null }),
  ].sort(compareSuiteResults);

  const idsInOrder = entries.map((entry) => entry.presetId);
  expect(idsInOrder).toEqual(['d', 'c', 'b', 'g', 'e', 'a', 'f']);
});

test('suiteResultRank returns higher numbers for better statuses', () => {
  expect(
    suiteResultRank(
      makeSuiteResult({ presetId: 'x', status: 'backend-mismatch' }),
    ),
  ).toBe(0);
  expect(
    suiteResultRank(makeSuiteResult({ presetId: 'x', status: 'fail' })),
  ).toBe(1);
  expect(
    suiteResultRank(makeSuiteResult({ presetId: 'x', status: 'error' })),
  ).toBe(2);
  expect(
    suiteResultRank(
      makeSuiteResult({ presetId: 'x', status: 'missing-stims-capture' }),
    ),
  ).toBe(3);
  expect(
    suiteResultRank(makeSuiteResult({ presetId: 'x', status: 'pass' })),
  ).toBe(4);
});

test('computeParityDiffMetrics throws with descriptive error on dimension mismatch', () => {
  const pixels2x1 = {
    width: 2,
    height: 1,
    channels: 4,
    data: Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255]),
  };
  const pixels1x1 = {
    width: 1,
    height: 1,
    channels: 4,
    data: Uint8Array.from([0, 0, 0, 255]),
  };

  expect(() =>
    computeParityDiffMetrics({
      stims: pixels2x1,
      projectm: pixels1x1,
      threshold: 0,
    }),
  ).toThrow(/dimensions differ/i);
});

test('loadImagePixels throws descriptive error for non-existent file', async () => {
  const missingPath = path.join(os.tmpdir(), 'stims-nonexistent-ref-99999.png');
  await expect(loadImagePixels(missingPath)).rejects.toThrow();
});
