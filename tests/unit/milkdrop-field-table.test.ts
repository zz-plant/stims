import { describe, expect, test } from 'bun:test';
import { DEFAULT_MILKDROP_STATE } from 'milkdrop-toolchain/src/compiler/default-state.ts';
import {
  aliasMap,
  normalizeProgramAssignmentTarget,
} from 'milkdrop-toolchain/src/field-normalization.ts';
import {
  buildFieldAliasMap,
  editorFieldKey,
  MILKDROP_FIELDS,
  MILKDROP2_FIELD_PAIRS,
} from 'milkdrop-toolchain/src/field-table.ts';
import {
  COLOR_GROUPS,
  SCALAR_CONTROLS,
  TOGGLE_CONTROLS,
} from '../../src/js/milkdrop/preset-controls.ts';

/**
 * The field table is the one place MilkDrop field names live; the compiler's
 * alias map, Format and Export all derive from it. These hold it consistent.
 */
describe('MilkDrop field table', () => {
  test('every field has a default the runtime starts from', () => {
    const missing = MILKDROP_FIELDS.map((spec) => spec.key).filter(
      (key) => !(key in DEFAULT_MILKDROP_STATE),
    );
    expect(missing).toEqual([]);
  });

  test('keys, MilkDrop 2 keys and spellings are each claimed once', () => {
    const keys = MILKDROP_FIELDS.map((spec) => spec.key);
    expect(new Set(keys).size).toBe(keys.length);
    const md2 = MILKDROP2_FIELD_PAIRS.map(([key]) => key.toLowerCase());
    expect(new Set(md2).size).toBe(md2.length);
    const claimed = new Map<string, string>();
    for (const spec of MILKDROP_FIELDS) {
      for (const alias of spec.aliases ?? []) {
        const owner = claimed.get(alias);
        expect(owner === undefined || owner === spec.key).toBe(true);
        claimed.set(alias, spec.key);
      }
    }
  });

  test('every MilkDrop 2 spelling resolves to its field', () => {
    for (const [md2, key] of MILKDROP2_FIELD_PAIRS) {
      expect(normalizeProgramAssignmentTarget(md2)).toBe(key);
    }
    for (const spec of MILKDROP_FIELDS) {
      for (const alias of spec.aliases ?? []) {
        expect(normalizeProgramAssignmentTarget(alias)).toBe(spec.key);
      }
    }
  });

  test('the compiler alias map is the table, not a second copy', () => {
    expect(aliasMap).toEqual(buildFieldAliasMap());
  });

  test('Format keeps its historical spellings', () => {
    expect(editorFieldKey('decay')).toBe('fDecay');
    expect(editorFieldKey('brighten')).toBe('bBrighten');
    expect(editorFieldKey('gammaadj')).toBe('gammaadj');
  });

  test('every Tune control addresses a field the runtime has', () => {
    const keys = [
      ...SCALAR_CONTROLS.map((control) => control.key),
      ...TOGGLE_CONTROLS.map((control) => control.key),
      ...COLOR_GROUPS.flatMap((group) => [
        ...group.rgb,
        ...(group.alpha ? [group.alpha.key] : []),
      ]),
    ];
    const unknown = keys.filter(
      (key) =>
        !(normalizeProgramAssignmentTarget(key) in DEFAULT_MILKDROP_STATE),
    );
    expect(unknown).toEqual([]);
  });
});
