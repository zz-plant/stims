import { afterEach, describe, expect, test } from 'bun:test';
import {
  presetFileName,
  readPresetArchive,
  writePresetArchive,
} from '../../src/js/milkdrop/preset-archive.ts';
import { createMilkdropPresetFileActions } from '../../src/js/milkdrop/runtime/preset-file-actions.ts';
import type {
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
  MilkdropCompiledPreset,
  MilkdropPresetSource,
} from '../../src/js/milkdrop/types.ts';

/**
 * Exporting your own presets as a pack: the backup for work that otherwise
 * lives only in this browser, written as MilkDrop 2 files.
 */
describe('writePresetArchive', () => {
  test('packs presets the importer reads straight back', async () => {
    const bytes = await writePresetArchive([
      { title: 'Rovastar - Bytes', source: 'zoom=1.01\n' },
      { title: 'Geiss - Dots', source: 'zoom=0.99\n' },
    ]);
    const files = await readPresetArchive(bytes, 'mine.zip');
    const byName = Object.fromEntries(
      await Promise.all(files.map(async (f) => [f.name, await f.text()])),
    );
    expect(byName).toEqual({
      'Geiss - Dots.milk': 'zoom=0.99\n',
      'Rovastar - Bytes.milk': 'zoom=1.01\n',
    });
  });

  test('two presets with one title both survive, whatever the case', async () => {
    const bytes = await writePresetArchive([
      { title: 'Same', source: 'a' },
      { title: 'same', source: 'b' },
      { title: 'Same', source: 'c' },
    ]);
    const names = (await readPresetArchive(bytes, 'x.zip'))
      .map((f) => f.name)
      .sort();
    expect(names).toEqual(['Same (3).milk', 'Same.milk', 'same (2).milk']);
  });

  test('file names drop characters no file system accepts', () => {
    expect(presetFileName('a/b\\c: "d"? <e>|*')).toBe('a b c d e.milk');
    expect(presetFileName('   ')).toBe('preset.milk');
  });
});

describe('exportUserPresets', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  const entry = (id: string, title: string, origin: string) =>
    ({ id, title, origin }) as unknown as MilkdropCatalogEntry;

  const harness = (
    entries: MilkdropCatalogEntry[],
    sources: Record<string, string>,
    drafts: Record<string, string> = {},
  ) => {
    const statuses: string[] = [];
    let blob: Blob | null = null;
    URL.createObjectURL = ((value: Blob) => {
      blob = value;
      return 'blob:pack';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = () => {};
    const catalogStore = {
      listPresets: async () => entries,
      getPresetSource: async (id: string) =>
        sources[id] === undefined
          ? null
          : ({ id, title: id, raw: sources[id] } as MilkdropPresetSource),
      getDraft: async (id: string) => drafts[id] ?? null,
    } as unknown as MilkdropCatalogStore;
    const actions = createMilkdropPresetFileActions({
      catalogStore,
      getActiveCatalogEntry: () => null,
      getActiveCompiled: () => ({}) as unknown as MilkdropCompiledPreset,
      scheduleCatalogSync: async () => {},
      selectPreset: async () => {},
      setStatus: (message: string) => statuses.push(message),
    });
    return {
      actions,
      statuses,
      pack: async () => {
        if (!blob) throw new Error('nothing was downloaded');
        const files = await readPresetArchive(
          new Uint8Array(await (blob as Blob).arrayBuffer()),
          'pack.zip',
        );
        return Object.fromEntries(
          await Promise.all(files.map(async (f) => [f.name, await f.text()])),
        );
      },
    };
  };

  test('packs the user’s presets as MilkDrop 2 files, drafts included, bundled ones left out', async () => {
    const { actions, statuses, pack } = harness(
      [
        entry('mine', 'Me - Mine', 'user'),
        entry('brought', 'Someone - Brought In', 'imported'),
        entry('shipped', 'Geiss - Shipped', 'bundled'),
      ],
      {
        mine: 'title=Mine\nzoom=1.01\n',
        brought: 'title=Brought\nzoom=1.02\n',
        shipped: 'title=Shipped\nzoom=1.03\n',
      },
      { mine: 'title=Mine\nzoom=1.5\n' },
    );
    expect(await actions.exportUserPresets()).toBe(2);
    const files = await pack();
    expect(Object.keys(files).sort()).toEqual([
      'Me - Mine.milk',
      'Someone - Brought In.milk',
    ]);
    const mine = files['Me - Mine.milk'] as string;
    expect(mine.startsWith('MILKDROP_PRESET_VERSION=201\n')).toBe(true);
    // The draft is the latest version of the work.
    expect(mine).toContain('\nzoom=1.5\n');
    expect(statuses.at(-1)).toBe('Exported 2 presets as a .zip.');
  });

  test('with nothing of the user’s own it says so and downloads nothing', async () => {
    const { actions, statuses, pack } = harness(
      [entry('shipped', 'Geiss - Shipped', 'bundled')],
      { shipped: 'zoom=1\n' },
    );
    expect(await actions.exportUserPresets()).toBe(0);
    expect(statuses.at(-1)).toContain('Nothing of yours to export yet');
    await expect(pack()).rejects.toThrow('nothing was downloaded');
  });
});
