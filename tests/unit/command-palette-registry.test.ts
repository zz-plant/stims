import { describe, expect, test } from 'bun:test';
import {
  buildPaletteResults,
  type CommandAction,
} from '../../src/js/frontend/command-palette-registry.ts';

function action(id: string, label: string): CommandAction {
  return { id, label, run: () => {} };
}

describe('buildPaletteResults frecency', () => {
  const actions = [
    action('a', 'Alpha action'),
    action('b', 'Beta action'),
    action('c', 'Gamma action'),
  ];

  test('empty query returns authored order when no use counts', () => {
    const results = buildPaletteResults({ query: '', actions });
    expect(results.map((r) => r.id)).toEqual([
      'action:a',
      'action:b',
      'action:c',
    ]);
  });

  test('empty query ranks most-used first', () => {
    const results = buildPaletteResults({
      query: '',
      actions,
      useCounts: { 'action:c': 5, 'action:b': 1 },
    });
    expect(results.map((r) => r.id)).toEqual([
      'action:c',
      'action:b',
      'action:a',
    ]);
  });

  test('frecency reorders within a match tier but never beats a better tier', () => {
    // "action" is a substring hit on all three (same tier); "a" alone is a
    // prefix hit on Alpha only. Frecency must reorder the substring tier
    // without ever promoting a substring match above the prefix match.
    const heavilyUsed = buildPaletteResults({
      query: 'action',
      actions,
      useCounts: { 'action:c': 100 },
    });
    expect(heavilyUsed[0].id).toBe('action:c');

    const prefixQuery = buildPaletteResults({
      query: 'alpha',
      actions,
      useCounts: { 'action:c': 100 },
    });
    expect(prefixQuery[0].id).toBe('action:a');
  });

  test('preset rows AND multi-token queries across title and author', () => {
    // Shared matcher behavior: browse has always matched "geiss dream" this
    // way, and the palette now agrees.
    const presets = [
      { id: 'dream', title: 'Dreamcatcher', author: 'Geiss' },
      { id: 'other', title: 'Dreamcatcher', author: 'Rovastar' },
    ];
    const results = buildPaletteResults({
      query: 'geiss dream',
      actions: [],
      presets,
    });
    expect(results.map((r) => r.id)).toEqual(['preset:dream']);
  });

  test('unused results are unaffected (zero boost)', () => {
    const withCounts = buildPaletteResults({
      query: '',
      actions,
      useCounts: {},
    });
    const withoutCounts = buildPaletteResults({ query: '', actions });
    expect(withCounts.map((r) => r.id)).toEqual(withoutCounts.map((r) => r.id));
  });
});

/**
 * The empty-query list is the palette's only discovery surface, and it was
 * being sliced to the search limit — with 34 actions registered, two thirds
 * of them were reachable only by typing a name you had no way to learn.
 */
describe('the unfiltered list is not truncated to the search limit', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    id: `action-${index}`,
    label: `Action ${index}`,
    run: () => {},
  }));

  test('an empty query can list every action when asked to', () => {
    const results = buildPaletteResults({
      query: '',
      actions: many,
      limit: many.length,
    });
    expect(results).toHaveLength(many.length);
  });

  test('a typed query still honours the limit it is given', () => {
    const results = buildPaletteResults({
      query: 'action',
      actions: many,
      limit: 12,
    });
    expect(results).toHaveLength(12);
  });
});
