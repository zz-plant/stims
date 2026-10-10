/**
 * Lineage in share links, end to end.
 *
 * A `.milk` export carries a remix's parents as `remix_of_N_*` fields and
 * import reads them back (#1371). A share link hashed only the live draft,
 * so the same remix shared as a link arrived as a root work. These cover the
 * whole hop chain — remix → link → decode → import → export → re-import —
 * asserting the lineage is intact at every step, not just present in one.
 */
import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { exportMilkdrop2Preset } from 'milkdrop-toolchain/src/milkdrop2-export.ts';
import { lineageFromFields } from 'milkdrop-toolchain/src/preset-lineage-fields.ts';
import {
  buildRemixShareUrl,
  decodePresetCodeFromHash,
} from '../../src/js/frontend/url-state.ts';
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

// A draft shaped like a real one: scalar fields, then a shader section the
// lineage lines must not land inside (the parser would swallow them as
// shader text).
const DRAFT = [
  'MILKDROP_PRESET_VERSION=201',
  '[preset00]',
  'fRating=3.000',
  'zoom=1.02',
  'warp=0.9',
  '[warp_shader]',
  'shader_body {',
  '  ret = tex2d(sampler_main, uv).xyz;',
  '}',
  '',
].join('\n');

function importHarness() {
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
  return { actions, saved };
}

describe('remix lineage in share links', () => {
  test('a link carries the draft plus its remix parents', () => {
    const url = buildRemixShareUrl(
      'https://toil.fyi/?preset=geiss-casino-remix-42&tool=editor',
      DRAFT,
      PARENTS,
    );

    const decoded = decodePresetCodeFromHash(new URL(url).hash);
    if (decoded === null) throw new Error('the link decoded to nothing');
    expect(decoded).not.toBe(DRAFT);
    expect(decoded).toContain('remix_of_1_id=geiss-casino');
    expect(decoded).toContain('remix_of_2_title="Eo.S. - Glowsticks"');
    // The draft's own fields all survive beside the lineage.
    for (const line of DRAFT.trimEnd().split('\n')) {
      expect(decoded).toContain(line);
    }

    // The receiving side reads the lineage back exactly as an import of an
    // exported file would.
    const compiled = compileMilkdropPresetSource(decoded, {
      id: 'geiss-casino-remix-42',
      title: 'Geiss - Casino (Remix)',
      origin: 'imported',
    });
    expect(lineageFromFields(compiled.ir.preservedFields)).toEqual(PARENTS);
  });

  test('a link without lineage still decodes to the plain draft', () => {
    // Links written before this change — and every share of a root work
    // after it — carry no remix_of fields and must decode unchanged.
    const url = buildRemixShareUrl(
      'https://toil.fyi/?preset=signal-bloom',
      DRAFT,
    );
    expect(decodePresetCodeFromHash(new URL(url).hash)).toBe(DRAFT);
  });

  test('the recipient imports the link as a preset with its lineage intact', async () => {
    const url = buildRemixShareUrl('https://toil.fyi/', DRAFT, PARENTS);
    const decoded = decodePresetCodeFromHash(new URL(url).hash);
    if (decoded === null) throw new Error('the link decoded to nothing');
    const { actions, saved } = importHarness();

    await actions.importFiles([
      new File([decoded], 'geiss-casino-remix-42.milk', {
        type: 'text/plain',
      }),
    ] as unknown as FileList);

    expect(saved).toHaveLength(1);
    expect(saved[0].derivedFrom).toEqual(PARENTS);
  });

  test('exporting the imported remix and re-importing keeps the lineage', async () => {
    const url = buildRemixShareUrl('https://toil.fyi/', DRAFT, PARENTS);
    const decoded = decodePresetCodeFromHash(new URL(url).hash);
    if (decoded === null) throw new Error('the link decoded to nothing');
    const { actions, saved } = importHarness();
    await actions.importFiles([
      new File([decoded], 'geiss-casino-remix-42.milk', {
        type: 'text/plain',
      }),
    ] as unknown as FileList);
    const imported = saved[0];

    const file = exportMilkdrop2Preset(
      compileMilkdropPresetSource(imported.raw, imported),
    );
    // Written exactly once, not doubled by the copy that arrived inside
    // the source.
    expect(file.match(/remix_of_1_id=/g)?.length).toBe(1);
    expect(file).toContain('remix_of_2_id=eos-glowsticks');

    const { actions: reimport, saved: resaved } = importHarness();
    await reimport.importFiles([
      new File([file], 'geiss-casino-remix-42.milk', {
        type: 'text/plain',
      }),
    ] as unknown as FileList);
    expect(resaved[0].derivedFrom).toEqual(PARENTS);
  });

  test('re-sharing a re-imported draft neither loses nor stacks lineage', () => {
    const first = decodePresetCodeFromHash(
      new URL(buildRemixShareUrl('https://toil.fyi/', DRAFT, PARENTS)).hash,
    );
    if (first === null) throw new Error('the link decoded to nothing');
    const second = decodePresetCodeFromHash(
      new URL(buildRemixShareUrl('https://toil.fyi/', first, PARENTS)).hash,
    );
    if (second === null)
      throw new Error('the re-shared link decoded to nothing');

    expect(second.match(/remix_of_1_id=/g)?.length).toBe(1);
    expect(second).toBe(first);
  });

  test('lineage counts against the sharing budget, not around it', () => {
    // The largest draft whose plain link still fits can be one whose
    // lineage fields do not. The honest answer is the same "too long"
    // refusal as any over-budget draft — never a link that quietly drops
    // the lineage to fit, and never a silently truncated one.
    let chosen: string | null = null;
    for (let step = 1; step <= 500; step += 1) {
      const candidate = `${DRAFT}${'// padding line\n'.repeat(step * 10)}`;
      let lineageOver = false;
      try {
        buildRemixShareUrl('https://toil.fyi/', candidate, PARENTS);
      } catch {
        lineageOver = true;
      }
      if (!lineageOver) continue;
      try {
        if (
          buildRemixShareUrl('https://toil.fyi/', candidate).length <= 16_000
        ) {
          chosen = candidate;
        }
      } catch {
        // both encodings over budget: the window is behind us
      }
      break;
    }

    expect(chosen).not.toBeNull();
    expect(chosen).not.toBe(DRAFT);
    expect(() =>
      buildRemixShareUrl('https://toil.fyi/', chosen as string, PARENTS),
    ).toThrow('too long');
  });
});
