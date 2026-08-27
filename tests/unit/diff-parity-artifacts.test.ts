import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { scoreReferenceSignal } from '../../scripts/check-parity-reference-signal.ts';
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
  judgeAgainstNoiseBand,
  summarizeNoiseSamples,
} from '../../scripts/parity-noise-bands.ts';
import {
  compareSuiteResults,
  type SuitePresetResult,
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
    referenceSignal: null,
    stimsArtifactId: null,
    baselineMismatchRatio: null,
    mismatchDelta: null,
    noiseResolution: null,
    ...overrides,
    noiseBand: overrides.noiseBand ?? null,
    changeVerdict: overrides.changeVerdict ?? 'no-baseline',
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

test('judgeAgainstNoiseBand refuses to call a sub-noise delta an improvement', () => {
  // The real numbers this exists for: 250-wavecode measured 1.02% and 0.49%
  // across two serial runs of the same build, a 0.53pp move inside a band that
  // spans 0.50-1.13%. Reported as a delta it looks like the mismatch halved.
  const band = {
    presetId: '250-wavecode',
    backend: 'webgpu' as const,
    repeats: 5,
    threshold: 16,
    warmupFrames: 900,
    samples: [0.005, 0.0113],
    min: 0.005,
    max: 0.0113,
    median: 0.00815,
    mean: 0.00815,
    stdDev: 0.00315,
    width: 0.0063,
    contended: false,
    measuredAt: '2026-08-22T00:00:00.000Z',
  };

  expect(
    judgeAgainstNoiseBand({ current: 0.0049, baseline: 0.0102, band }).verdict,
  ).toBe('no-measurable-change');
  expect(
    judgeAgainstNoiseBand({ current: 0.0001, baseline: 0.0102, band }).verdict,
  ).toBe('improved');
  expect(
    judgeAgainstNoiseBand({ current: 0.2, baseline: 0.0102, band }).verdict,
  ).toBe('regressed');
  // Without a calibrated band the suite must not imply the delta means
  // anything, so an uncalibrated preset gets its own verdict.
  expect(
    judgeAgainstNoiseBand({ current: 0.0049, baseline: 0.0102, band: null })
      .verdict,
  ).toBe('noise-band-unmeasured');
  expect(
    judgeAgainstNoiseBand({ current: 0.0049, baseline: null, band }).verdict,
  ).toBe('no-baseline');
  // The resolution applied is never narrower than the observed range: a range
  // from a handful of samples understates the real spread.
  expect(
    judgeAgainstNoiseBand({ current: 0.0049, baseline: 0.0102, band })
      .resolution ?? 0,
  ).toBeGreaterThanOrEqual(band.width);
});

test('summarizeNoiseSamples reports the observed spread, not a model of it', () => {
  const stats = summarizeNoiseSamples([0.01, 0.03, 0.02]);
  expect(stats.min).toBeCloseTo(0.01, 10);
  expect(stats.max).toBeCloseTo(0.03, 10);
  expect(stats.median).toBeCloseTo(0.02, 10);
  expect(stats.width).toBeCloseTo(0.02, 10);
});

test('scoreReferenceSignal refuses a reference a blank frame would pass', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-signal-'));
  const blackPath = path.join(dir, 'black.png');
  const brightPath = path.join(dir, 'bright.png');
  await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toFile(blackPath);
  await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 200, g: 180, b: 120, alpha: 1 },
    },
  })
    .png()
    .toFile(brightPath);

  const blank = await scoreReferenceSignal({
    presetId: 'all-black',
    imagePath: blackPath,
    threshold: 16,
    failThreshold: 0.02,
    minHeadroom: 4,
  });
  expect(blank.status).toBe('no-signal');
  expect(blank.blankFrameMismatch).toBe(0);

  const bright = await scoreReferenceSignal({
    presetId: 'all-bright',
    imagePath: brightPath,
    threshold: 16,
    failThreshold: 0.02,
    minHeadroom: 4,
  });
  expect(bright.status).toBe('ok');
  expect(bright.blankFrameMismatch).toBe(1);

  fs.rmSync(dir, { recursive: true, force: true });
});
