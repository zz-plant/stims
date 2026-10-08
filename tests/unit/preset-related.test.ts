import { describe, expect, test } from 'bun:test';
import type { PresetMetaTable } from '../../functions/shared/preset-meta.ts';
import { relatedPresetGroups } from '../../functions/shared/preset-related.ts';

const table: PresetMetaTable = {
  a1: ['Geiss - One', 'Geiss'],
  a2: ['Geiss - Two', 'Geiss'],
  a3: ['Geiss - Three', 'Geiss'],
  b1: ['Flexi - One', 'Flexi'],
  s1: ['Stahlregen - Solo', 'Stahlregen'],
  s2: ['Stahlregen - Solo 2', 'Stahlregen'],
  sg: ['Stahlregen + Geiss - Pair', 'Stahlregen + Geiss'],
  u1: ['Mystery', 'Unknown'],
  u2: ['Other mystery', 'Unknown'],
};

/** The groups as `handle: ids` pairs, for compact expectations. */
const groups = (presetId: string, limit?: number) =>
  relatedPresetGroups(table, presetId, limit).map(
    (group) => `${group.handle}: ${group.ids.join(' ')}`,
  );

describe('relatedPresetGroups', () => {
  test('a single author gets one group of presets crediting them, never itself', () => {
    // sg credits Geiss too, so it is a Geiss preset for this purpose: the
    // same rule the /author/geiss page lists by.
    expect(groups('a1')).toEqual(['Geiss: a2 a3 sg']);
    expect(groups('a2')).toEqual(['Geiss: a3 sg a1']);
  });

  test('rotates with the id so links spread across the author list', () => {
    expect(groups('a2', 1)).toEqual(['Geiss: a3']);
    expect(groups('a3', 1)).toEqual(['Geiss: sg']);
  });

  test('a credit chain gets one group per hand, splitting the limit, with no repeats', () => {
    // Stahlregen first, as the chain credits them; each hand gets half of six.
    expect(groups('sg')).toEqual(['Stahlregen: s1 s2', 'Geiss: a1 a2 a3']);
    // A preset listed under the first hand is not listed again.
    const ids = relatedPresetGroups(table, 'sg').flatMap((g) => g.ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('sg');
  });

  test('gives nothing for a sole preset, an unknown author or an unknown id', () => {
    expect(groups('b1')).toEqual([]);
    // "Unknown" is a placeholder, not an author: it must not link strangers together.
    expect(groups('u1')).toEqual([]);
    expect(groups('nope')).toEqual([]);
  });
});
