import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProjectMReferenceDestinationNames } from '../scripts/import-projectm-reference.ts';
import {
  appendParityArtifactEntry,
  buildParityArtifactId,
  buildParityArtifactStem,
  createDefaultParityArtifactManifest,
  hashFileSha256,
  loadParityArtifactManifest,
} from '../scripts/parity-artifacts.ts';

test('buildParityArtifactStem includes the source kind and preset id', () => {
  expect(
    buildParityArtifactStem({
      kind: 'projectm-reference',
      slug: 'milkdrop',
      presetId: 'Rovastar / Parallel Universe',
    }),
  ).toBe('projectm-reference--milkdrop--preset--rovastar-parallel-universe');
});

test('buildParityArtifactId adds a normalized time segment', () => {
  expect(
    buildParityArtifactId({
      kind: 'stims-capture',
      slug: 'milkdrop',
      presetId: 'signal-bloom',
      createdAt: '2026-03-28T15:04:05.000Z',
    }),
  ).toBe('stims-capture--milkdrop--preset--signal-bloom--20260328150405');
});

test('loads a default parity artifact manifest when none exists', () => {
  expect(createDefaultParityArtifactManifest()).toEqual({
    version: 1,
    artifacts: [],
  });
});

test('appendParityArtifactEntry stores output-relative file paths', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stims-parity-'));
  const imagePath = path.join(tempDir, 'capture.png');
  const debugPath = path.join(tempDir, 'capture.debug.json');
  fs.writeFileSync(imagePath, 'image');
  fs.writeFileSync(debugPath, '{"ok":true}\n');

  appendParityArtifactEntry(tempDir, {
    kind: 'stims-capture',
    slug: 'milkdrop',
    presetId: 'signal-bloom',
    createdAt: '2026-03-28T15:04:05.000Z',
    files: {
      image: imagePath,
      debugSnapshot: debugPath,
    },
  });

  expect(loadParityArtifactManifest(tempDir)).toEqual({
    version: 1,
    artifacts: [
      expect.objectContaining({
        files: {
          image: 'capture.png',
          debugSnapshot: 'capture.debug.json',
          metadata: null,
        },
      }),
    ],
  });
});

test('hashFileSha256 returns a stable digest', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stims-parity-hash-'));
  const filePath = path.join(tempDir, 'reference.png');
  fs.writeFileSync(filePath, 'abc');

  expect(hashFileSha256(filePath)).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('buildProjectMReferenceDestinationNames preserves image extensions', () => {
  expect(
    buildProjectMReferenceDestinationNames({
      slug: 'milkdrop',
      presetId: 'signal-bloom',
      createdAt: '2026-03-28T15:04:05.000Z',
      imagePath: '/tmp/reference.jpeg',
      metadataPath: '/tmp/reference.json',
    }),
  ).toEqual({
    imageName:
      'projectm-reference--milkdrop--preset--signal-bloom--20260328150405.jpeg',
    metadataName:
      'projectm-reference--milkdrop--preset--signal-bloom--20260328150405.json',
  });
});
