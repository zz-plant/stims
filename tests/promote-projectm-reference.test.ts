import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { appendParityArtifactEntry } from '../scripts/parity-artifacts.ts';
import { promoteProjectMReference } from '../scripts/promote-projectm-reference.ts';
import { loadVisualReferenceManifest } from '../scripts/visual-reference-manifest.ts';

test('promoteProjectMReference copies a projectM artifact into tracked fixtures and updates the manifest', async () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-promote-reference-repo-'),
  );
  const outputDir = path.join(repoRoot, 'screenshots', 'parity');
  const sourceImagePath = path.join(outputDir, 'projectm-reference.png');
  const sourceMetadataPath = path.join(outputDir, 'projectm-reference.json');

  fs.mkdirSync(outputDir, { recursive: true });
  await sharp({
    create: {
      width: 4,
      height: 3,
      channels: 4,
      background: { r: 12, g: 34, b: 56, alpha: 1 },
    },
  })
    .png()
    .toFile(sourceImagePath);
  fs.writeFileSync(sourceMetadataPath, '{"frame":42}\n');

  appendParityArtifactEntry(outputDir, {
    kind: 'projectm-reference',
    slug: 'milkdrop',
    presetId: 'signal-bloom',
    title: 'Signal Bloom',
    files: {
      image: sourceImagePath,
      metadata: sourceMetadataPath,
    },
    provenance: {
      label: 'projectM import',
    },
  });

  const result = await promoteProjectMReference({
    repoRoot,
    outputDir,
    presetId: 'signal-bloom',
    strata: ['feedback', 'shader-supported'],
  });

  expect(fs.existsSync(result.image)).toBe(true);
  expect(result.metadata ? fs.existsSync(result.metadata) : false).toBe(true);

  const manifest = loadVisualReferenceManifest(repoRoot);
  expect(manifest.presets).toHaveLength(1);
  expect(manifest.presets[0]).toEqual(
    expect.objectContaining({
      id: 'signal-bloom',
      title: 'Signal Bloom',
      strata: ['feedback', 'shader-supported'],
      image: 'signal-bloom.png',
      metadata: 'signal-bloom.meta.json',
      sourceFamily: 'projectm-fixture',
      tolerance: {
        profile: 'default',
        threshold: 16,
        failThreshold: 0.02,
      },
      capture: {
        renderer: 'projectm',
        requiredBackend: 'webgpu',
        width: 4,
        height: 3,
        warmupMs: 5000,
        captureOffsetMs: 0,
      },
    }),
  );
});

test('promoteProjectMReference can promote a direct local projectM image without an artifact manifest', async () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-promote-reference-direct-repo-'),
  );
  const sourceImagePath = path.join(repoRoot, 'candidate-projectm.png');

  await sharp({
    create: {
      width: 6,
      height: 4,
      channels: 4,
      background: { r: 90, g: 120, b: 150, alpha: 1 },
    },
  })
    .png()
    .toFile(sourceImagePath);

  const result = await promoteProjectMReference({
    repoRoot,
    outputDir: path.join(repoRoot, 'screenshots', 'parity'),
    presetId: 'candidate-projectm',
    sourceImagePath,
    strata: ['feedback', 'shader-supported'],
  });

  expect(fs.existsSync(result.image)).toBe(true);
  expect(loadVisualReferenceManifest(repoRoot).presets).toEqual([
    expect.objectContaining({
      id: 'candidate-projectm',
      title: 'Candidate ProjectM',
      image: 'candidate-projectm.png',
      sourceFamily: 'projectm-fixture',
      provenance: expect.objectContaining({
        label: 'existing repo artifact',
        sourceArtifactId: null,
      }),
    }),
  ]);
});
