import type { MilkdropCatalogEntry } from './types';

// The catalog bundler stamps community-import entries `curatedRank: 10_000 +
// index`, so rank-before-import reads as sorted number order: curated picks
// surface first, the mass import after.

export function sortMilkdropCatalogEntries(
  entries: MilkdropCatalogEntry[],
): MilkdropCatalogEntry[] {
  return [...entries].sort((left, right) => {
    if (left.isFavorite !== right.isFavorite) {
      return left.isFavorite ? -1 : 1;
    }
    if (
      (left.historyIndex ?? Number.MAX_SAFE_INTEGER) !==
      (right.historyIndex ?? Number.MAX_SAFE_INTEGER)
    ) {
      return (
        (left.historyIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.historyIndex ?? Number.MAX_SAFE_INTEGER)
      );
    }
    if ((left.lastOpenedAt ?? 0) !== (right.lastOpenedAt ?? 0)) {
      return (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0);
    }
    // A fresh visitor has no favorites or history, so this is the first
    // quality signal they see: curated picks before the community import,
    // then the entry's measured quality score, then any explicit rating.
    if (
      (left.curatedRank ?? Number.MAX_SAFE_INTEGER) !==
      (right.curatedRank ?? Number.MAX_SAFE_INTEGER)
    ) {
      return (
        (left.curatedRank ?? Number.MAX_SAFE_INTEGER) -
        (right.curatedRank ?? Number.MAX_SAFE_INTEGER)
      );
    }
    if ((left.quality?.score ?? 0) !== (right.quality?.score ?? 0)) {
      return (right.quality?.score ?? 0) - (left.quality?.score ?? 0);
    }
    if (left.rating !== right.rating) {
      return right.rating - left.rating;
    }
    return left.title.localeCompare(right.title);
  });
}
