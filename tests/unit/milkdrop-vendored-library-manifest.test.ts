import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

type VendoredLibraryManifest = {
  libraryId: string;
  presets: Array<{
    id: string;
    file: string;
  }>;
};

test('public vendored projectM library stays in sync with the vendored fixture set', () => {
  const repoRoot = process.cwd();
  const sourceDir = path.join(
    repoRoot,
    'tests',
    'fixtures',
    'milkdrop',
    'projectm-upstream',
  );
  const publicDir = path.join(
    repoRoot,
    'public',
    'milkdrop-presets',
    'libraries',
    'projectm-upstream',
  );
  const manifestPath = path.join(publicDir, 'catalog.json');
  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ) as VendoredLibraryManifest;

  const sourceFiles = readdirSync(sourceDir)
    .filter((file) => file.endsWith('.milk'))
    .sort();
  const publicFiles = readdirSync(publicDir)
    .filter((file) => file.endsWith('.milk'))
    .sort();

  expect(existsSync(manifestPath)).toBe(true);
  expect(manifest.libraryId).toBe('projectm-upstream');
  expect(publicFiles).toEqual(sourceFiles);
  expect(manifest.presets).toHaveLength(sourceFiles.length);
  expect(manifest.presets.map((entry) => `${entry.id}.milk`).sort()).toEqual(
    sourceFiles,
  );

  manifest.presets.forEach((entry) => {
    expect(
      existsSync(path.join(repoRoot, 'public', entry.file.replace(/^\/+/, ''))),
    ).toBe(true);
  });
});
