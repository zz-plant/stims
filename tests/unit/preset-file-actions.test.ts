import { describe, expect, test } from 'bun:test';
import { createMilkdropPresetFileActions } from '../../src/js/milkdrop/runtime/preset-file-actions.ts';
import type {
  MilkdropCatalogStore,
  MilkdropCompiledPreset,
  MilkdropPresetSource,
} from '../../src/js/milkdrop/types.ts';

function makeHarness({
  compiled,
  existingTitles = [],
}: {
  compiled: { id: string; title: string; author?: string };
  existingTitles?: string[];
}) {
  const saved: MilkdropPresetSource[] = [];
  const catalogStore = {
    async listPresets() {
      return existingTitles.map((title, index) => ({ id: `t${index}`, title }));
    },
    async savePreset(source: MilkdropPresetSource) {
      saved.push(source);
      return source;
    },
  } as unknown as MilkdropCatalogStore;

  const actions = createMilkdropPresetFileActions({
    catalogStore,
    getActiveCatalogEntry: () => null,
    getActiveCompiled: () =>
      ({
        source: { id: compiled.id, title: compiled.title, origin: 'bundled' },
        title: compiled.title,
        author: compiled.author,
        formattedSource: '[preset00]\nfRating=3',
      }) as unknown as MilkdropCompiledPreset,
    scheduleCatalogSync: async () => {},
    selectPreset: async () => {},
  });
  return { actions, saved };
}

function toFileList(...files: File[]) {
  return {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: function* () {
      yield* files;
    },
  } as unknown as FileList;
}

describe('duplicatePreset mints remix credits', () => {
  test('a root work gains the mix slot and a lineage ref', async () => {
    const { actions, saved } = makeHarness({
      compiled: {
        id: 'aderrasi-airhandler',
        title: 'Aderrasi - Airhandler',
        author: 'Aderrasi',
      },
    });
    await actions.duplicatePreset();

    expect(saved).toHaveLength(1);
    const record = saved[0];
    expect(record.title).toBe('Aderrasi - Airhandler (Remix)');
    expect(record.author).toBe('Aderrasi');
    expect(record.origin).toBe('user');
    expect(record.id).toStartWith('aderrasi-airhandler-remix-');
    expect(record.derivedFrom).toEqual([
      {
        id: 'aderrasi-airhandler',
        title: 'Aderrasi - Airhandler',
        author: 'Aderrasi',
      },
    ]);
  });

  test('title collisions number the remix instead of stacking "Copy"', async () => {
    const { actions, saved } = makeHarness({
      compiled: {
        id: 'aderrasi-airhandler',
        title: 'Aderrasi - Airhandler',
        author: 'Aderrasi',
      },
      existingTitles: [
        'Aderrasi - Airhandler (Remix)',
        'Aderrasi - Airhandler (Remix 2)',
      ],
    });
    await actions.duplicatePreset();

    expect(saved[0].title).toBe('Aderrasi - Airhandler (Remix 3)');
  });

  test('remixing an existing mix keeps its name and adds an edit marker', async () => {
    const { actions, saved } = makeHarness({
      compiled: {
        id: 'krash-rovastar-cerebral-demons-stars',
        title: 'Krash & Rovastar - Cerebral Demons (Stars Remix)',
        author: 'Krash & Rovastar',
      },
    });
    await actions.duplicatePreset();

    // The formatter canonicalizes "&" to "+" when re-emitting the chain.
    expect(saved[0].title).toBe(
      'Krash + Rovastar - Cerebral Demons (Stars Remix) [remix]',
    );
    expect(saved[0].author).toBe('Krash + Rovastar');
    expect(saved[0].derivedFrom?.[0]?.id).toBe(
      'krash-rovastar-cerebral-demons-stars',
    );
  });

  test('a multi-hand chain survives the fork intact', async () => {
    const { actions, saved } = makeHarness({
      compiled: {
        id: 'stahlregen-geiss-shifter-babylon',
        title: 'Stahlregen + Geiss + Shifter - Babylon',
        author: 'Stahlregen + Geiss + Shifter',
      },
    });
    await actions.duplicatePreset();

    expect(saved[0].title).toBe(
      'Stahlregen + Geiss + Shifter - Babylon (Remix)',
    );
  });
});

describe('importFiles input validation', () => {
  test('rejects files larger than 2 MB with a recovery action', async () => {
    const { actions } = makeHarness({
      compiled: { id: 'test', title: 'Test' },
    });
    const oversizedFile = new File(
      [new Uint8Array(2 * 1024 * 1024 + 1)],
      'oversized.milk',
      { type: 'text/plain' },
    );

    await expect(
      actions.importFiles(toFileList(oversizedFile)),
    ).rejects.toThrow(
      'Failed to import "oversized.milk": the file is larger than the 2 MB limit. Choose a smaller plain-text .milk file.',
    );
  });

  test('rejects empty or whitespace-only files', async () => {
    const { actions } = makeHarness({
      compiled: { id: 'test', title: 'Test' },
    });
    const emptyFile = new File(['   '], 'empty.milk', { type: 'text/plain' });
    await expect(actions.importFiles(toFileList(emptyFile))).rejects.toThrow(
      'Failed to import "empty.milk": the file is empty. Choose a .milk file that contains preset text.',
    );
  });

  test('rejects binary files containing null bytes', async () => {
    const { actions } = makeHarness({
      compiled: { id: 'test', title: 'Test' },
    });
    const binaryFile = new File(['[preset00]\x00\x01\x02'], 'binary.milk', {
      type: 'text/plain',
    });
    await expect(actions.importFiles(toFileList(binaryFile))).rejects.toThrow(
      'Failed to import "binary.milk": binary data was detected. Choose a plain-text .milk file.',
    );
  });
});
