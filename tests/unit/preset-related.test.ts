import { describe, expect, test } from 'bun:test';
import type { PresetMetaTable } from '../../functions/shared/preset-meta.ts';
import { relatedPresetIds } from '../../functions/shared/preset-related.ts';

const table: PresetMetaTable = {
  a1: ['Geiss - One', 'Geiss'],
  a2: ['Geiss - Two', 'Geiss'],
  a3: ['Geiss - Three', 'Geiss'],
  b1: ['Flexi - One', 'Flexi'],
  u1: ['Mystery', 'Unknown'],
  u2: ['Other mystery', 'Unknown'],
};

describe('relatedPresetIds', () => {
  test('returns same-author siblings, never the preset itself', () => {
    expect(relatedPresetIds(table, 'a1')).toEqual(['a2', 'a3']);
    expect(relatedPresetIds(table, 'a2')).not.toContain('a2');
  });

  test('rotates with the id so links spread across the author list', () => {
    expect(relatedPresetIds(table, 'a2', 1)).toEqual(['a3']);
    expect(relatedPresetIds(table, 'a3', 1)).toEqual(['a1']);
  });

  test('respects the limit', () => {
    expect(relatedPresetIds(table, 'a1', 1)).toEqual(['a2']);
  });

  test('gives nothing for a sole preset, an unknown author or an unknown id', () => {
    expect(relatedPresetIds(table, 'b1')).toEqual([]);
    // "Unknown" is a placeholder, not an author: it must not link strangers together.
    expect(relatedPresetIds(table, 'u1')).toEqual([]);
    expect(relatedPresetIds(table, 'nope')).toEqual([]);
  });
});
