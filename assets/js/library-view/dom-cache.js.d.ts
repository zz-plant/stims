export type LibraryDomCache = {
  ensureMetaNode: () => HTMLElement | null;
  ensureSearchForm: () => HTMLFormElement | null;
  ensureSearchClearButton: () => HTMLElement | null;
  ensureFilterResetButton: () => HTMLElement | null;
  ensureSearchSuggestions: () => HTMLElement | null;
  ensureActiveFiltersSummary: () => HTMLElement | null;
  ensureActiveFiltersChips: () => HTMLElement | null;
  ensureActiveFiltersClear: () => HTMLElement | null;
  ensureActiveFiltersStatus: () => HTMLElement | null;
  ensureSearchMetaNote: () => HTMLElement | null;
  ensureLibraryRefine: () => HTMLElement | null;
};

export function createLibraryDomCache(doc?: Document): LibraryDomCache;
