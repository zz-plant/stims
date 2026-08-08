import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendParityArtifactEntry,
  loadParityArtifactManifest,
  pruneParityArtifacts,
  reconcileParityArtifactManifest,
} from '../../scripts/parity-artifacts.ts';

const tempDirs: string[] = [];

function makeOutputDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stims-parity-prune-'));
  tempDirs.push(dir);
  return dir;
}

function writeCapture(dir: string, name: string) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'png-bytes');
  return file;
}

function addEntry(
  dir: string,
  presetId: string,
  createdAt: string,
  { keepPerPreset = 3 }: { keepPerPreset?: number } = {},
) {
  const image = writeCapture(dir, `capture-${presetId}-${createdAt}.png`);
  return appendParityArtifactEntry(
    dir,
    {
      kind: 'stims-capture',
      slug: 'milkdrop',
      presetId,
      createdAt,
      files: { image },
    },
    { keepPerPreset },
  );
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('parity artifact retention', () => {
  test('appending bounds the manifest to the newest N captures per preset', () => {
    const dir = makeOutputDir();
    for (let i = 1; i <= 6; i += 1) {
      addEntry(dir, 'square', `2026-08-0${i}T00:00:00.000Z`, {
        keepPerPreset: 2,
      });
    }

    const manifest = loadParityArtifactManifest(dir);
    expect(manifest.artifacts).toHaveLength(2);
    expect(manifest.artifacts.map((entry) => entry.createdAt)).toEqual([
      '2026-08-05T00:00:00.000Z',
      '2026-08-06T00:00:00.000Z',
    ]);
  });

  test('superseded capture files are deleted from disk, not just unlinked from the manifest', () => {
    const dir = makeOutputDir();
    addEntry(dir, 'square', '2026-08-01T00:00:00.000Z', { keepPerPreset: 1 });
    addEntry(dir, 'square', '2026-08-02T00:00:00.000Z', { keepPerPreset: 1 });

    const pngs = fs.readdirSync(dir).filter((name) => name.endsWith('.png'));
    expect(pngs).toEqual(['capture-square-2026-08-02T00:00:00.000Z.png']);
  });

  test('retention is per preset, so one busy preset cannot evict another', () => {
    const dir = makeOutputDir();
    addEntry(dir, 'square', '2026-08-01T00:00:00.000Z', { keepPerPreset: 1 });
    addEntry(dir, 'wave', '2026-08-02T00:00:00.000Z', { keepPerPreset: 1 });
    addEntry(dir, 'wave', '2026-08-03T00:00:00.000Z', { keepPerPreset: 1 });

    const manifest = loadParityArtifactManifest(dir);
    expect(manifest.artifacts.map((entry) => entry.presetId).sort()).toEqual([
      'square',
      'wave',
    ]);
  });

  test('cited evidence survives pruning regardless of age', () => {
    const dir = makeOutputDir();
    const { entry: oldest } = addEntry(
      dir,
      'square',
      '2026-08-01T00:00:00.000Z',
      {
        keepPerPreset: 99,
      },
    );
    addEntry(dir, 'square', '2026-08-02T00:00:00.000Z', { keepPerPreset: 99 });
    addEntry(dir, 'square', '2026-08-03T00:00:00.000Z', { keepPerPreset: 99 });

    const citedFile = path.resolve(dir, oldest.files.image ?? '');
    const { manifest, removedFiles } = pruneParityArtifacts(
      dir,
      loadParityArtifactManifest(dir),
      { keepPerPreset: 1, keepFiles: new Set([citedFile]) },
    );

    expect(removedFiles).not.toContain(citedFile);
    expect(fs.existsSync(citedFile)).toBe(true);
    expect(manifest.artifacts.map((entry) => entry.id)).toContain(oldest.id);
  });

  test('reconcile drops entries whose files were removed out of band', () => {
    const dir = makeOutputDir();
    const { entry } = addEntry(dir, 'square', '2026-08-01T00:00:00.000Z');
    fs.rmSync(path.join(dir, entry.files.image ?? ''), { force: true });

    const { manifest, dropped } = reconcileParityArtifactManifest(
      dir,
      loadParityArtifactManifest(dir),
    );

    expect(dropped.map((item) => item.id)).toEqual([entry.id]);
    expect(manifest.artifacts).toHaveLength(0);
  });

  test('a file shared by a retained entry is not deleted', () => {
    const dir = makeOutputDir();
    const shared = writeCapture(dir, 'shared.png');
    for (const createdAt of [
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z',
    ]) {
      appendParityArtifactEntry(
        dir,
        {
          kind: 'stims-capture',
          slug: 'milkdrop',
          presetId: 'square',
          createdAt,
          files: { image: shared },
        },
        { keepPerPreset: 99 },
      );
    }

    pruneParityArtifacts(dir, loadParityArtifactManifest(dir), {
      keepPerPreset: 1,
      keepFiles: new Set(),
    });

    expect(fs.existsSync(shared)).toBe(true);
  });
});
