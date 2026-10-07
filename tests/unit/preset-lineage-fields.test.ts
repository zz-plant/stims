import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { exportMilkdrop2Preset } from 'milkdrop-toolchain/src/milkdrop2-export.ts';
import {
  lineageFieldLines,
  lineageFromFields,
} from 'milkdrop-toolchain/src/preset-lineage-fields.ts';
import { createMilkdropPresetFileActions } from '../../src/js/milkdrop/runtime/preset-file-actions.ts';
import type {
  MilkdropCatalogStore,
  MilkdropCompiledPreset,
  MilkdropPresetSource,
} from '../../src/js/milkdrop/types.ts';

const PARENTS = [
  { id: 'geiss-casino', title: 'Geiss - Casino', author: 'Geiss' },
  { id: 'eos-glowsticks', title: 'Eo.S. - Glowsticks' },
];

describe('remix lineage in the preset file', () => {
  test('an exported remix names its parents, once each', () => {
    const compiled = compileMilkdropPresetSource('title=Mine\nzoom=1.01\n', {
      id: 'mine',
      title: 'Mine',
      origin: 'user',
      derivedFrom: PARENTS,
    });
    const file = exportMilkdrop2Preset(compiled);
    expect(file).toContain('remix_of_1_id=geiss-casino');
    expect(file).toContain('remix_of_1_title="Geiss - Casino"');
    expect(file).toContain('remix_of_1_author=Geiss');
    expect(file).toContain('remix_of_2_id=eos-glowsticks');

    // Re-exporting a file that already carries the keys does not double them.
    const again = exportMilkdrop2Preset(
      compileMilkdropPresetSource(file, {
        id: 'mine',
        title: 'Mine',
        origin: 'user',
        derivedFrom: PARENTS,
      }),
    );
    expect(again.match(/remix_of_1_id=/g)?.length).toBe(1);
  });

  test('the keys are metadata, not unknown fields', () => {
    const compiled = compileMilkdropPresetSource(
      ['title=Mine', 'zoom=1.01', ...lineageFieldLines(PARENTS)].join('\n'),
      { id: 'mine' },
    );
    expect(
      compiled.diagnostics.filter((d) => /remix_of/.test(d.message)),
    ).toEqual([]);
    expect(lineageFromFields(compiled.ir.preservedFields)).toEqual(PARENTS);
  });

  test('importing an exported remix restores its lineage', async () => {
    const saved: MilkdropPresetSource[] = [];
    const drafts: string[] = [];
    const actions = createMilkdropPresetFileActions({
      catalogStore: {
        async savePreset(source: MilkdropPresetSource) {
          saved.push(source);
          return source;
        },
        async saveDraft(id: string) {
          drafts.push(id);
        },
      } as unknown as MilkdropCatalogStore,
      getActiveCatalogEntry: () => null,
      getActiveCompiled: () => ({}) as MilkdropCompiledPreset,
      scheduleCatalogSync: async () => {},
      selectPreset: async () => {},
    });
    const exported = exportMilkdrop2Preset(
      compileMilkdropPresetSource('title=Mine\nzoom=1.01\n', {
        id: 'mine',
        title: 'Mine',
        origin: 'user',
        derivedFrom: PARENTS,
      }),
    );
    const file = new File([exported], 'Mine.milk', { type: 'text/plain' });
    await actions.importFiles([file] as unknown as FileList);
    expect(saved[0]?.derivedFrom).toEqual(PARENTS);
    // An import is not an edit: no draft.
    expect(drafts).toEqual([]);
  });

  test('an imported file keeps the title written in it', async () => {
    const saved: MilkdropPresetSource[] = [];
    const actions = createMilkdropPresetFileActions({
      catalogStore: {
        async savePreset(source: MilkdropPresetSource) {
          saved.push(source);
          return source;
        },
      } as unknown as MilkdropCatalogStore,
      getActiveCatalogEntry: () => null,
      getActiveCompiled: () => ({}) as MilkdropCompiledPreset,
      scheduleCatalogSync: async () => {},
      selectPreset: async () => {},
    });
    const named = new File(
      ['title="Geiss - Casino (Remix)"\nzoom=1.01\n'],
      'geiss-casino-remix-123.milk',
    );
    const untitled = new File(['zoom=1.01\n'], 'Rovastar - Bytes 03.milk');
    await actions.importFiles([named, untitled] as unknown as FileList);
    expect(saved.map((source) => source.title)).toEqual([
      'Geiss - Casino (Remix)',
      'Rovastar - Bytes 03',
    ]);
  });
});
