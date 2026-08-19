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
