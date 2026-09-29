import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  expandPresetSelection,
  isPresetEntry,
  MAX_ARCHIVE_PRESETS,
  readPresetArchive,
} from '../../src/js/milkdrop/preset-archive.ts';
import { createMilkdropPresetFileActions } from '../../src/js/milkdrop/runtime/preset-file-actions.ts';
import type {
  MilkdropCatalogStore,
  MilkdropCompiledPreset,
  MilkdropPresetSource,
} from '../../src/js/milkdrop/types.ts';

const PRESET_A = 'title=A\nzoom=1.01\nper_frame_1=rot = rot + 0.01;\n';
const PRESET_B = 'title=B\nzoom=0.99\n';

const zip = (entries: Record<string, string>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, text]) => [name, strToU8(text)]),
    ),
  );
const zipFile = (name: string, entries: Record<string, string>) =>
  new File([zip(entries)], name, { type: 'application/zip' });

describe('preset archives', () => {
  test('takes the .milk files from a pack, including subfolders, and nothing else', async () => {
    const presets = await readPresetArchive(
      zip({
        'Rovastar - Bytes.milk': PRESET_A,
        'pack/sub/Geiss - Dots.milk': PRESET_B,
        'readme.txt': 'hello',
        'pack/cover.png': 'not a preset',
        '__MACOSX/pack/._Geiss - Dots.milk': 'resource fork',
        'pack/._hidden.milk': 'resource fork',
      }),
      'pack.zip',
    );
    expect(presets.map((p) => p.name)).toEqual([
      'Geiss - Dots.milk',
      'Rovastar - Bytes.milk',
    ]);
    const bytes = presets.find((p) => p.name.startsWith('Rovastar'));
    expect(await bytes?.text()).toBe(PRESET_A);
    expect(bytes?.size).toBe(new TextEncoder().encode(PRESET_A).length);
  });

  test('stops taking presets past the per-archive cap', async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < MAX_ARCHIVE_PRESETS + 5; i += 1) {
      entries[`p${String(i).padStart(5, '0')}.milk`] = 'zoom=1\n';
    }
    const presets = await readPresetArchive(zip(entries), 'big.zip');
    expect(presets).toHaveLength(MAX_ARCHIVE_PRESETS);
  });

  test('a corrupt archive is a readable error, not a crash', async () => {
    await expect(
      readPresetArchive(new Uint8Array([1, 2, 3, 4, 5]), 'broken.zip'),
    ).rejects.toThrow(/not a readable \.zip archive/u);
  });

  test('entry filtering ignores folders and resource forks', () => {
    expect(isPresetEntry('a/b/c.milk')).toBe(true);
    expect(isPresetEntry('a/b/')).toBe(false);
    expect(isPresetEntry('__MACOSX/a.milk')).toBe(false);
    expect(isPresetEntry('._a.milk')).toBe(false);
    expect(isPresetEntry('A.MILK')).toBe(true);
  });

  test('a mixed selection keeps .milk files and expands zips; bad archives are reported', async () => {
    const skipped: string[] = [];
    const loose = new File([PRESET_B], 'Loose.milk', { type: 'text/plain' });
    const presets = await expandPresetSelection(
      [
        loose,
        zipFile('pack.zip', { 'In Pack.milk': PRESET_A }),
        zipFile('empty.zip', { 'notes.txt': 'no presets here' }),
        new File([new Uint8Array([9, 9, 9])], 'broken.zip'),
      ],
      (name, reason) => skipped.push(`${name}: ${reason}`),
    );
    expect(presets.map((p) => p.name)).toEqual(['Loose.milk', 'In Pack.milk']);
    expect(skipped).toEqual([
      'empty.zip: the archive contains no .milk presets.',
      expect.stringContaining('broken.zip: "broken.zip" is not a readable'),
    ]);
  });
});

describe('importing a pack', () => {
  test('every preset in a .zip is imported, with its filename credit', async () => {
    const saved: MilkdropPresetSource[] = [];
    const statuses: string[] = [];
    const catalogStore = {
      async savePreset(source: MilkdropPresetSource) {
        saved.push(source);
        return source;
      },
      async saveDraft() {},
    } as unknown as MilkdropCatalogStore;
    const actions = createMilkdropPresetFileActions({
      catalogStore,
      getActiveCatalogEntry: () => null,
      getActiveCompiled: () => ({}) as unknown as MilkdropCompiledPreset,
      scheduleCatalogSync: async () => {},
      selectPreset: async () => {},
      setStatus: (message) => statuses.push(message),
    });
    const files = [
      zipFile('pack.zip', {
        'Rovastar - Bytes.milk': 'zoom=1.01\n',
        'sub/Geiss - Dots.milk': 'zoom=0.99\n',
      }),
    ];
    await actions.importFiles(files as unknown as FileList);

    expect(saved.map((s) => s.fileName).sort()).toEqual([
      'Geiss - Dots.milk',
      'Rovastar - Bytes.milk',
    ]);
    expect(
      saved.find((s) => s.fileName === 'Rovastar - Bytes.milk')?.author,
    ).toBe('Rovastar');
    expect(statuses.at(-1)).toBe('Imported 2 presets.');
  });

  test('an archive with no presets fails the import with a clear reason', async () => {
    const actions = createMilkdropPresetFileActions({
      catalogStore: {} as unknown as MilkdropCatalogStore,
      getActiveCatalogEntry: () => null,
      getActiveCompiled: () => ({}) as unknown as MilkdropCompiledPreset,
      scheduleCatalogSync: async () => {},
      selectPreset: async () => {},
    });
    await expect(
      actions.importFiles([
        zipFile('empty.zip', { 'notes.txt': 'x' }),
      ] as unknown as FileList),
    ).rejects.toThrow(/contains no \.milk presets/u);
  });
});
