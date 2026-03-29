import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  computeParityDiffMetrics,
  diffParityArtifacts,
} from '../scripts/diff-parity-artifacts.ts';
import {
  appendParityArtifactEntry,
  loadParityArtifactManifest,
} from '../scripts/parity-artifacts.ts';

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
