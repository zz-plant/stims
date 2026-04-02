import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path, { basename, join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';

type LibraryManifest = {
  libraryId: string;
  presets: Array<{
    id: string;
    title: string;
    file: string;
  }>;
};

const LIBRARY_ID = 'projectm-cream-of-the-crop';
const PUBLIC_DIR = path.join(
  process.cwd(),
  'public',
  'milkdrop-presets',
  'libraries',
  LIBRARY_ID,
);
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'catalog.json');

test('projectM Cream of the Crop library manifest stays aligned with the shipped preset files', () => {
  const manifest = JSON.parse(
    readFileSync(MANIFEST_PATH, 'utf8'),
  ) as LibraryManifest;
  const publicFiles = readdirSync(PUBLIC_DIR)
    .filter((file) => file.endsWith('.milk'))
    .sort();

  expect(existsSync(MANIFEST_PATH)).toBe(true);
  expect(manifest.libraryId).toBe(LIBRARY_ID);
  expect(manifest.presets).toHaveLength(publicFiles.length);
  expect(manifest.presets.map((entry) => `${entry.id}.milk`).sort()).toEqual(
    publicFiles,
  );

  manifest.presets.forEach((entry) => {
    expect(
      existsSync(
        path.join(process.cwd(), 'public', entry.file.replace(/^\/+/, '')),
      ),
    ).toBe(true);
  });
});

test('projectM Cream of the Crop picks stay fully supported on both backends', () => {
  const manifest = JSON.parse(
    readFileSync(MANIFEST_PATH, 'utf8'),
  ) as LibraryManifest;

  manifest.presets.forEach((entry) => {
    const raw = readFileSync(
      join(process.cwd(), 'public', entry.file.replace(/^\/+/, '')),
      'utf8',
    );
    const compiled = compileMilkdropPresetSource(raw, {
      id: entry.id,
      title: entry.title,
      fileName: basename(entry.file),
      origin: 'bundled',
    });

    expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
    expect(compiled.ir.compatibility.backends.webgpu.status).toBe('supported');
    expect(compiled.ir.compatibility.parity.fidelityClass).toBe('exact');
  });
});
