import { describe, expect, test } from 'bun:test';
import type { PresetCatalogEntry } from '../assets/js/frontend/contracts.ts';
import {
  mergeCatalogActivity,
  pickFavoritePresets,
  pickRecentPresets,
} from '../assets/js/frontend/workspace-helpers.ts';

function createEntry(
  id: string,
  title: string,
  overrides: Partial<PresetCatalogEntry> = {},
): PresetCatalogEntry {
  return {
    id,
    title,
    author: 'Stims',
    tags: [],
    ...overrides,
  };
}

describe('workspace activity helpers', () => {
  test('merges favorite and recent metadata onto the base catalog', () => {
    const merged = mergeCatalogActivity(
      [
        createEntry('signal-bloom', 'Signal Bloom'),
        createEntry('night-drive', 'Night Drive'),
      ],
      [
        createEntry('signal-bloom', 'Signal Bloom', {
          isFavorite: true,
          historyIndex: 0,
          lastOpenedAt: 30,
        }),
        createEntry('custom-echo', 'Custom Echo', {
          isFavorite: true,
          lastOpenedAt: 10,
        }),
      ],
    );

    expect(merged).toEqual([
      expect.objectContaining({
        id: 'signal-bloom',
        isFavorite: true,
        historyIndex: 0,
        lastOpenedAt: 30,
      }),
      expect.objectContaining({
        id: 'night-drive',
      }),
      expect.objectContaining({
        id: 'custom-echo',
        isFavorite: true,
      }),
    ]);
  });

  test('sorts recent presets by history position first', () => {
    const recent = pickRecentPresets([
      createEntry('negative', 'Negative', {
        historyIndex: -1,
        lastOpenedAt: 99,
      }),
      createEntry('third', 'Third', { historyIndex: 2, lastOpenedAt: 20 }),
      createEntry('first', 'First', { historyIndex: 0, lastOpenedAt: 10 }),
      createEntry('second', 'Second', { historyIndex: 1, lastOpenedAt: 30 }),
      createEntry('ignored', 'Ignored'),
    ]);

    expect(recent.map((entry) => entry.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  test('sorts favorite presets by recency and fallback title order', () => {
    const favorites = pickFavoritePresets([
      createEntry('gamma', 'Gamma', { isFavorite: true, lastOpenedAt: 20 }),
      createEntry('beta', 'Beta', { isFavorite: true, lastOpenedAt: 20 }),
      createEntry('alpha', 'Alpha', { isFavorite: true, lastOpenedAt: 40 }),
      createEntry('plain', 'Plain'),
    ]);

    expect(favorites.map((entry) => entry.id)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });
});
