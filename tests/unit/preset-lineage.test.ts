import { describe, expect, test } from 'bun:test';
import {
  buildPresetFamilies,
  findPresetFamily,
  type LineageCatalogEntry,
} from '../../src/js/milkdrop/preset-lineage.ts';

const entry = (id: string, title: string, author?: string) => ({
  id,
  title,
  author,
});

/** The Airhandler branch, as it ships in the catalog. */
const airhandler: LineageCatalogEntry[] = [
  entry('root', 'Aderrasi - Airhandler', 'Aderrasi'),
  entry('kali', 'Aderrasi - Airhandler (Kali Mix)', 'Aderrasi'),
  entry('square', 'Aderrasi + Geiss - Airhandler (Square Mix)', 'Aderrasi'),
  entry('sadako', 'shifter + Aderrasi - Airhandler (Sadako)', 'shifter'),
  entry('unrelated', 'Geiss - Casino', 'Geiss'),
];

describe('buildPresetFamilies', () => {
  test('groups every mix of a work under one base title', () => {
    const families = buildPresetFamilies(airhandler);
    const family = families.get('airhandler');
    expect(family?.baseTitle).toBe('Airhandler');
    // Root first, then by accretion depth, then alphabetically — so the two
    // two-author mixes tie and fall back to their labels.
    expect(family?.members.map((member) => member.id)).toEqual([
      'root',
      'kali',
      'sadako',
      'square',
    ]);
  });

  test('the root work sorts first and is flagged as a root', () => {
    const family = buildPresetFamilies(airhandler).get('airhandler');
    expect(family?.members[0].isRoot).toBe(true);
    expect(family?.members[0].label).toBe('Airhandler');
    expect(family?.members.filter((member) => member.isRoot)).toHaveLength(1);
  });

  test('reports the hands each derivative adds to the root credit', () => {
    const family = buildPresetFamilies(airhandler).get('airhandler');
    const byId = Object.fromEntries(
      (family?.members ?? []).map((member) => [member.id, member]),
    );
    expect(byId.square.authors).toEqual(['Aderrasi', 'Geiss']);
    expect(byId.square.addedAuthors).toEqual(['Geiss']);
    // The remixer joins the byline even when they are named first.
    expect(byId.sadako.addedAuthors).toEqual(['shifter']);
    expect(byId.root.addedAuthors).toEqual([]);
  });

  test('canonicalizes handles so one author is not split by spelling', () => {
    const family = buildPresetFamilies([
      entry('a', 'fiShbRaiN - witchcraft'),
      entry('b', 'fishbrain + geiss - witchcraft (Glow Mix)'),
    ]).get('witchcraft');
    expect(family?.members[1].authors).toEqual(['fiShbRaiN', 'Geiss']);
    expect(family?.members[1].addedAuthors).toEqual(['Geiss']);
  });

  test('shader-model variants of one work stay in the same family', () => {
    const family = buildPresetFamilies([
      entry('a', 'martin - rogue wave -ps2'),
      entry('b', 'martin - rogue wave -ps3'),
    ]).get('rogue wave');
    expect(family?.members).toHaveLength(2);
    expect(family?.members.map((member) => member.shaderModel)).toEqual([
      'ps2',
      'ps3',
    ]);
  });

  test('a numbered series is not one remix family', () => {
    // "Mashup (160)" and "Mashup (169)" are separate works by one author, not
    // two remixes of a work called "Mashup".
    const families = buildPresetFamilies([
      entry('a', '$$$ Royal - Mashup (160)'),
      entry('b', '$$$ Royal - Mashup (169)'),
    ]);
    expect(families.get('mashup 160')?.members).toHaveLength(1);
    expect(families.get('mashup 169')?.members).toHaveLength(1);
  });
});

describe('findPresetFamily', () => {
  test('finds the family from any member', () => {
    for (const id of ['root', 'kali', 'square', 'sadako']) {
      expect(findPresetFamily(airhandler, id)?.key).toBe('airhandler');
    }
  });

  test('a preset with no shipped relatives has no lineage to show', () => {
    expect(findPresetFamily(airhandler, 'unrelated')).toBeNull();
  });

  test('an unknown preset id resolves to null', () => {
    expect(findPresetFamily(airhandler, 'nope')).toBeNull();
  });
});
