import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildNativeProjectMReferenceMetadata } from '../scripts/native-projectm-reference.ts';
import {
  appendParityArtifactEntry,
  hashFileSha256,
} from '../scripts/parity-artifacts.ts';
import { promoteProjectMReference } from '../scripts/promote-projectm-reference.ts';
import { loadVisualReferenceManifest } from '../scripts/visual-reference-manifest.ts';

function writeNativeMetadata({
  repoRoot,
  presetId,
  imagePath,
  metadataPath,
  width,
  height,
}: {
  repoRoot: string;
  presetId: string;
  imagePath: string;
  metadataPath: string;
  width: number;
  height: number;
}) {
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
  if (!fs.existsSync(presetPath)) {
    fs.writeFileSync(presetPath, `[preset00]\nname=${presetId}\n`);
  }
  if (!fs.existsSync(harnessPath)) {
    fs.writeFileSync(harnessPath, '// native projectM harness\n');
  }
  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify(
      buildNativeProjectMReferenceMetadata({
        presetId,
        presetPath,
        presetSha256: hashFileSha256(presetPath),
        imageSha256: hashFileSha256(imagePath),
        width,
        height,
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
}

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
  writeNativeMetadata({
    repoRoot,
    presetId: 'signal-bloom',
    imagePath: sourceImagePath,
    metadataPath: sourceMetadataPath,
    width: 4,
    height: 3,
  });

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
  const sourceMetadataPath = path.join(repoRoot, 'candidate-projectm.json');

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
  writeNativeMetadata({
    repoRoot,
    presetId: 'candidate-projectm',
    imagePath: sourceImagePath,
    metadataPath: sourceMetadataPath,
    width: 6,
    height: 4,
  });

  const result = await promoteProjectMReference({
    repoRoot,
    outputDir: path.join(repoRoot, 'screenshots', 'parity'),
    presetId: 'candidate-projectm',
    sourceImagePath,
    sourceMetadataPath,
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

test('promoteProjectMReference refuses a direct image without native projectM provenance', async () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-promote-unverified-reference-'),
  );
  const sourceImagePath = path.join(repoRoot, 'unverified.png');
  await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toFile(sourceImagePath);

  await expect(
    promoteProjectMReference({
      repoRoot,
      outputDir: path.join(repoRoot, 'screenshots', 'parity'),
      presetId: 'unverified',
      sourceImagePath,
      strata: [],
    }),
  ).rejects.toThrow('native projectM metadata sidecar');
});

test('promoteProjectMReference rejects provenance for a stale upstream fixture or harness', async () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-promote-stale-reference-'),
  );
  const sourceImagePath = path.join(repoRoot, 'candidate.png');
  const sourceMetadataPath = path.join(repoRoot, 'candidate.json');
  await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toFile(sourceImagePath);
  writeNativeMetadata({
    repoRoot,
    presetId: '100-square',
    imagePath: sourceImagePath,
    metadataPath: sourceMetadataPath,
    width: 2,
    height: 2,
  });
  fs.appendFileSync(
    path.join(
      repoRoot,
      'tests/fixtures/milkdrop/projectm-upstream/100-square.milk',
    ),
    'changed=1\n',
  );

  await expect(
    promoteProjectMReference({
      repoRoot,
      outputDir: path.join(repoRoot, 'screenshots/parity'),
      presetId: '100-square',
      sourceImagePath,
      sourceMetadataPath,
      strata: [],
    }),
  ).rejects.toThrow('current upstream fixture');
});
