import { describe, expect, test } from 'bun:test';
import {
  MILKDROP_BUILTIN_DOCS,
  MILKDROP_INTRINSIC_FUNCTION_NAMES,
} from 'milkdrop-toolchain/src/builtin-docs.ts';
import { searchReference } from '../../src/js/milkdrop/reference-search.ts';

describe('reference search', () => {
  test('an exact name outranks prefix and substring matches', () => {
    const names = searchReference('sin').map((entry) => entry.name);
    expect(names[0]).toBe('sin');
    expect(names.indexOf('sin')).toBeLessThan(names.indexOf('asin'));
  });

  test('finds a function by what it does, not just by name', () => {
    const hits = searchReference('absolute value').map((entry) => entry.name);
    expect(hits).toContain('abs');
  });

  test('functions insert with their parameters, variables insert bare', () => {
    const clamp = searchReference('clamp')[0];
    expect(clamp?.insertText).toBe(
      `clamp(${MILKDROP_BUILTIN_DOCS.find((d) => d.name === 'clamp')?.params?.join(', ')})`,
    );
    const zoom = searchReference('zoom').find((entry) => entry.name === 'zoom');
    expect(zoom?.insertText).toBe('zoom');
  });

  test('the empty query hides the 64 registers; asking for q shows them', () => {
    const empty = searchReference('').map((entry) => entry.name);
    expect(empty).not.toContain('q1');
    const q = searchReference('q1').map((entry) => entry.name);
    expect(q).toContain('q1');
  });

  test('every intrinsic function the compiler accepts is findable', () => {
    for (const name of MILKDROP_INTRINSIC_FUNCTION_NAMES) {
      expect(
        searchReference(name, MILKDROP_BUILTIN_DOCS, 500).map((e) => e.name),
      ).toContain(name);
    }
  });

  test('categorises inputs versus variables the author sets', () => {
    const bass = searchReference('bass').find((entry) => entry.name === 'bass');
    expect(bass?.category).toBe('input');
    const rot = searchReference('rot').find((entry) => entry.name === 'rot');
    expect(rot?.category).toBe('you set');
  });
});

describe('builtin docs', () => {
  test('no doc just repeats the signature it sits next to', () => {
    // Autocomplete, hover and the Reference tab all show the signature beside
    // the doc, so a doc that is only the signature says nothing.
    const echoes = MILKDROP_BUILTIN_DOCS.filter((entry) =>
      /^[a-z_0-9]+\(/iu.test(entry.doc.trim()),
    ).map((entry) => entry.name);
    expect(echoes).toEqual([]);
  });
});
