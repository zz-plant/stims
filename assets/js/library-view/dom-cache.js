export function createLibraryDomCache(doc = document) {
  const cache = new Map();

  const ensure = (key, resolver) => {
    if (cache.has(key)) {
      return cache.get(key);
    }

    const resolved = resolver();
    if (resolved !== null) {
      cache.set(key, resolved);
    }

    return resolved;
  };

  return {
    ensureMetaNode: () =>
      ensure('meta', () => doc.querySelector('[data-search-results]')),
    ensureSearchForm: () =>
      ensure('search-form', () => doc.querySelector('[data-search-form]')),
    ensureSearchClearButton: () =>
      ensure('search-clear', () => doc.querySelector('[data-search-clear]')),
    ensureFilterResetButton: () =>
      ensure('filter-reset', () => doc.querySelector('[data-filter-reset]')),
    ensureSearchSuggestions: () =>
      ensure('search-suggestions', () =>
        doc.getElementById('toy-search-suggestions'),
      ),
    ensureActiveFiltersSummary: () =>
      ensure('active-filters-summary', () =>
        doc.querySelector('[data-active-filters]'),
      ),
    ensureActiveFiltersChips: () =>
      ensure('active-filters-chips', () =>
        doc.querySelector('[data-active-filters-chips]'),
      ),
    ensureActiveFiltersClear: () =>
      ensure('active-filters-clear', () =>
        doc.querySelector('[data-active-filters-clear]'),
      ),
    ensureActiveFiltersStatus: () =>
      ensure('active-filters-status', () =>
        doc.querySelector('[data-active-filters-status]'),
      ),
    ensureSearchMetaNote: () =>
      ensure('search-meta-note', () => doc.querySelector('[data-search-note]')),
    ensureLibraryRefine: () =>
      ensure('library-refine', () =>
        doc.querySelector('[data-library-refine]'),
      ),
  };
}
