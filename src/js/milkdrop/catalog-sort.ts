import type { MilkdropCatalogEntry } from './types';

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
    if (left.rating !== right.rating) {
      return right.rating - left.rating;
    }
    if (
      (left.curatedRank ?? Number.MAX_SAFE_INTEGER) !==
      (right.curatedRank ?? Number.MAX_SAFE_INTEGER)
    ) {
      return (
        (left.curatedRank ?? Number.MAX_SAFE_INTEGER) -
        (right.curatedRank ?? Number.MAX_SAFE_INTEGER)
      );
    }
    return left.title.localeCompare(right.title);
  });
}
