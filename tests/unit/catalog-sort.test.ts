import { describe, expect, test } from 'bun:test';

import { sortMilkdropCatalogEntries } from '../../src/js/milkdrop/catalog-sort.ts';
import type { MilkdropCatalogEntry } from '../../src/js/milkdrop/catalog-types.ts';

// The sort reads a small field set; the fixtures only need that set. Casting
// keeps the tests focused on ordering instead of rebuilding the full engine
// entry shape.
type SortFixture = {
  id: string;
  title: string;
  isFavorite?: boolean;
  rating?: number;
  historyIndex?: number;
  lastOpenedAt?: number;
  curatedRank?: number;
  quality?: { score?: number };
};

const asCatalog = (fixtures: SortFixture[]) =>
  fixtures as unknown as MilkdropCatalogEntry[];

const ids = (fixtures: SortFixture[]) =>
  sortMilkdropCatalogEntries(asCatalog(fixtures)).map((entry) => entry.id);

describe('sortMilkdropCatalogEntries', () => {
  test('orders curated picks before the community import for a fresh visitor', () => {
    // catalog-bundled-pipeline stamps community entries >= 10_000.
    expect(
      ids([
        { id: 'community-a', title: 'Community A', curatedRank: 10_042 },
        { id: 'curated-a', title: 'Curated A', curatedRank: 12 },
        { id: 'community-b', title: 'Community B', curatedRank: 10_001 },
        { id: 'curated-b', title: 'Curated B', curatedRank: 3 },
      ]),
    ).toEqual(['curated-b', 'curated-a', 'community-b', 'community-a']);
  });

  test('sinks entries with no curatedRank after everyone ranked', () => {
    expect(
      ids([
        { id: 'unranked', title: 'Unranked' },
        { id: 'curated', title: 'Curated', curatedRank: 7 },
      ]),
    ).toEqual(['curated', 'unranked']);
  });

  test('breaks ties inside one rank by measured quality score', () => {
    expect(
      ids([
        { id: 'low', title: 'Low', curatedRank: 5, quality: { score: 0.3 } },
        { id: 'high', title: 'High', curatedRank: 5, quality: { score: 0.9 } },
        { id: 'none', title: 'None', curatedRank: 5 },
      ]),
    ).toEqual(['high', 'low', 'none']);
  });

  test('favorites outrank curated picks', () => {
    expect(
      ids([
        { id: 'curated', title: 'Curated', curatedRank: 1 },
        { id: 'saved', title: 'Saved', curatedRank: 2, isFavorite: true },
      ]),
    ).toEqual(['saved', 'curated']);
  });

  test('recently opened outranks curated picks for returning visitors', () => {
    expect(
      ids([
        { id: 'curated', title: 'Curated', curatedRank: 1 },
        { id: 'recent', title: 'Recent', curatedRank: 2, lastOpenedAt: 9 },
        { id: 'older', title: 'Older', curatedRank: 3, lastOpenedAt: 8 },
      ]),
    ).toEqual(['recent', 'older', 'curated']);
  });

  test('explicit rating does not leapfrog curation rank', () => {
    expect(
      ids([
        { id: 'rated', title: 'Rated', curatedRank: 10_001, rating: 5 },
        { id: 'curated', title: 'Curated', curatedRank: 2, rating: 0 },
      ]),
    ).toEqual(['curated', 'rated']);
  });

  test('falls back to title within a fully tied rank', () => {
    expect(
      ids([
        { id: 'later', title: 'Zulu', curatedRank: 10 },
        { id: 'earlier', title: 'Alpha', curatedRank: 10 },
      ]),
    ).toEqual(['earlier', 'later']);
  });

  test('does not mutate the input array', () => {
    const fixtures: SortFixture[] = [
      { id: 'b', title: 'B', curatedRank: 2 },
      { id: 'a', title: 'A', curatedRank: 1 },
    ];
    sortMilkdropCatalogEntries(asCatalog(fixtures));
    expect(fixtures.map((entry) => entry.id)).toEqual(['b', 'a']);
  });
});
