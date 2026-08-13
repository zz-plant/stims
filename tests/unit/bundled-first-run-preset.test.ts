import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { DEFAULT_MILKDROP_PRESET_SOURCE } from '../../src/js/milkdrop/runtime/default-preset.ts';
import {
  FIRST_RUN_PRESET_AUTHOR,
  FIRST_RUN_PRESET_ID,
  FIRST_RUN_PRESET_TITLE,
} from '../../src/js/milkdrop/runtime/first-run-preset.ts';

const repoRoot = path.resolve(import.meta.dir, '../..');
const presetPath = path.join(
  repoRoot,
  'public/milkdrop-presets',
  `${FIRST_RUN_PRESET_ID}.milk`,
);
const catalogPath = path.join(repoRoot, 'public/milkdrop-presets/catalog.json');

function findCatalogEntry() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
    presets: {
      id: string;
      title?: string;
      author?: string;
      supports?: Record<string, boolean>;
    }[];
  };
  return catalog.presets.find((preset) => preset.id === FIRST_RUN_PRESET_ID);
}

describe('bundled first-run preset', () => {
  test('is a byte-identical copy of the first-run preset on disk', () => {
    // The bundled copy exists so the pre-catalog frames are already the preset
    // startup selection will land on. If the two drift, the visitor sees one
    // preset and then a crossfade to a different one — the exact failure the
    // copy was added to remove. Regenerate with:
    //   bun -e "const raw = await Bun.file('public/milkdrop-presets/${FIRST_RUN_PRESET_ID}.milk').text(); \
    //     const f = 'src/js/milkdrop/runtime/default-preset.ts'; const cur = await Bun.file(f).text(); \
    //     await Bun.write(f, cur.slice(0, cur.indexOf('\`') + 1) + raw + '\`;\n')"
    expect(DEFAULT_MILKDROP_PRESET_SOURCE).toBe(
      fs.readFileSync(presetPath, 'utf8'),
    );
  });

  test('is a real catalog id, so startup selection needs no special case', () => {
    const entry = findCatalogEntry();

    expect(entry).toBeDefined();
    // Selectable on both backends: an unsupported backend would send startup
    // selection to a different preset and reintroduce the swap.
    expect(entry?.supports?.webgl).toBe(true);
    expect(entry?.supports?.webgpu).toBe(true);
  });

  test('carries the same title and author the catalog will report', () => {
    // The runtime compiles the bundled source before any catalog exists, so it
    // needs this metadata inline — a third copy alongside catalog.json and
    // starter-catalog.json. Left unchecked, a retitled catalog entry would
    // change the document title and credit mid-load.
    const entry = findCatalogEntry();

    expect(FIRST_RUN_PRESET_TITLE).toBe(entry?.title ?? '');
    expect(FIRST_RUN_PRESET_AUTHOR).toBe(entry?.author ?? '');
  });

  test('compiles without errors', () => {
    const compiled = compileMilkdropPresetSource(
      DEFAULT_MILKDROP_PRESET_SOURCE,
      {
        id: FIRST_RUN_PRESET_ID,
        title: 'first-run',
        origin: 'bundled',
        author: 'test',
      },
    );

    expect(compiled.source.id).toBe(FIRST_RUN_PRESET_ID);
    expect(compiled.ir).toBeDefined();
  });
});
