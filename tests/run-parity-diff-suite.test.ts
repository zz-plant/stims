import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { appendParityArtifactEntry } from '../scripts/parity-artifacts.ts';
import { runParityDiffSuite } from '../scripts/run-parity-diff-suite.ts';
import { saveVisualReferenceManifest } from '../scripts/visual-reference-manifest.ts';

test('runParityDiffSuite ranks failing presets ahead of passing presets', async () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-parity-suite-repo-'),
  );
  const fixtureRoot = path.join(
    repoRoot,
    'tests',
    'fixtures',
    'milkdrop',
    'projectm-reference',
  );
  const outputDir = path.join(repoRoot, 'screenshots', 'parity');
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const writeImage = async (filePath: string, color: number) => {
    await sharp({
      create: {
        width: 2,
        height: 1,
        channels: 4,
        background: { r: color, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toFile(filePath);
  };

  await writeImage(path.join(fixtureRoot, 'pass.png'), 0);
  await writeImage(path.join(fixtureRoot, 'fail.png'), 0);
  await writeImage(path.join(outputDir, 'pass-stims.png'), 0);
  await writeImage(path.join(outputDir, 'fail-stims.png'), 64);

  saveVisualReferenceManifest(repoRoot, {
    version: 1,
    parityTarget: 'projectm-visual-reference',
    fixtureRoot: 'tests/fixtures/milkdrop/projectm-reference',
    minimumPresetCount: 0,
    presetCount: 2,
    defaults: {
      renderer: 'projectm',
      width: 2,
      height: 1,
      threshold: 16,
      failThreshold: 0.02,
    },
    presets: [
      {
        id: 'pass-preset',
        title: 'Pass Preset',
        image: 'pass.png',
        strata: ['feedback'],
        tolerance: { threshold: 16, failThreshold: 0.02 },
        capture: { renderer: 'projectm', width: 2, height: 1 },
        provenance: {
          label: 'fixture',
          importedAt: '2026-03-28T00:00:00.000Z',
        },
      },
      {
        id: 'fail-preset',
        title: 'Fail Preset',
        image: 'fail.png',
        strata: ['shader-supported'],
        tolerance: { threshold: 16, failThreshold: 0.02 },
        capture: { renderer: 'projectm', width: 2, height: 1 },
        provenance: {
          label: 'fixture',
          importedAt: '2026-03-28T00:00:00.000Z',
        },
      },
    ],
  });

  appendParityArtifactEntry(outputDir, {
    kind: 'stims-capture',
    slug: 'milkdrop',
    presetId: 'pass-preset',
    files: { image: path.join(outputDir, 'pass-stims.png') },
    createdAt: '2026-03-28T01:00:00.000Z',
  });
  appendParityArtifactEntry(outputDir, {
    kind: 'stims-capture',
    slug: 'milkdrop',
    presetId: 'fail-preset',
    files: { image: path.join(outputDir, 'fail-stims.png') },
    createdAt: '2026-03-28T01:00:00.000Z',
  });

  const result = await runParityDiffSuite({
    repoRoot,
    outputDir,
    writeDiffImages: true,
    strict: false,
  });

  expect(fs.existsSync(result.summaryPath)).toBe(true);
  expect(result.summary.results[0]?.presetId).toBe('fail-preset');
  expect(result.summary.results[0]?.status).toBe('fail');
  expect(result.summary.results[1]?.presetId).toBe('pass-preset');
  expect(result.summary.results[1]?.status).toBe('pass');
  expect(result.summary.failCount).toBe(1);
  expect(result.summary.passCount).toBe(1);
});

test('runParityDiffSuite reports missing stims captures', async () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-parity-suite-missing-'),
  );
  const fixtureRoot = path.join(
    repoRoot,
    'tests',
    'fixtures',
    'milkdrop',
    'projectm-reference',
  );
  const outputDir = path.join(repoRoot, 'screenshots', 'parity');
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toFile(path.join(fixtureRoot, 'missing.png'));

  saveVisualReferenceManifest(repoRoot, {
    version: 1,
    parityTarget: 'projectm-visual-reference',
    fixtureRoot: 'tests/fixtures/milkdrop/projectm-reference',
    minimumPresetCount: 0,
    presetCount: 1,
    defaults: {
      renderer: 'projectm',
      width: 1,
      height: 1,
      threshold: 16,
      failThreshold: 0.02,
    },
    presets: [
      {
        id: 'missing-preset',
        title: 'Missing Preset',
        image: 'missing.png',
        strata: [],
        tolerance: { threshold: 16, failThreshold: 0.02 },
        capture: { renderer: 'projectm', width: 1, height: 1 },
        provenance: {
          label: 'fixture',
          importedAt: '2026-03-28T00:00:00.000Z',
        },
      },
    ],
  });

  const result = await runParityDiffSuite({
    repoRoot,
    outputDir,
    writeDiffImages: false,
    strict: false,
  });

  expect(result.summary.missingCount).toBe(1);
  expect(result.summary.results[0]?.status).toBe('missing-stims-capture');
});
