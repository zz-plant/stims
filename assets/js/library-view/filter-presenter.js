export function createLibraryFilterPresenter({
  document,
  windowObject = typeof window === 'undefined' ? null : window,
  createFilterToken,
  defaultSort,
  ensureMetaNode,
  ensureSearchClearButton,
  ensureFilterResetButton,
  ensureActiveFiltersSummary,
  ensureActiveFiltersChips,
  ensureActiveFiltersClear,
  ensureActiveFiltersStatus,
  ensureSearchMetaNote,
  ensureLibraryRefine,
  ensureSortControl,
  ensureFilterChips,
  getState,
  getLastFilteredToys,
  getSearchInput,
  clearSearch,
  removeFilterToken,
  resetSort,
} = {}) {
  const filterLabelCache = new Map();

  const getSortLabel = () => {
    const state = getState();
    const sortControl = ensureSortControl();
    if (sortControl && sortControl.tagName === 'SELECT') {
      const selected = sortControl.selectedOptions?.[0];
      const label = selected?.textContent?.trim();
      if (label) return label;
    }
    const sortLabels = {
      featured: 'Featured',
      newest: 'Newest',
      immersive: 'Most immersive',
      az: 'A → Z',
    };
    return sortLabels[state.sort] ?? state.sort;
  };

  const formatTokenLabel = (token) => {
    if (filterLabelCache.has(token)) {
      return filterLabelCache.get(token);
    }
    const [type, value = ''] = token.split(':');
    if (!type) return token;
    const explicitChip = Array.from(ensureFilterChips()).find((chip) => {
      if (!(chip instanceof HTMLElement)) return false;
      return resolveChipToken(chip) === token;
    });
    const explicitLabel = explicitChip?.textContent?.trim();
    if (explicitLabel) {
      filterLabelCache.set(token, explicitLabel);
      return explicitLabel;
    }
    const normalizedValue = value.toLowerCase();
    const cacheKey = `${type}:${normalizedValue}`;
    const chipLabel = filterLabelCache.get(cacheKey);
    if (chipLabel) {
      filterLabelCache.set(token, chipLabel);
      return chipLabel;
    }
    const typeLabels = {
      compatible: 'More devices',
      mobile: 'Mobile-friendly',
      motion: 'Motion',
      microphone: 'Live mic',
      demoaudio: 'Demo audio',
    };
    const fallbackLabel = normalizedValue.replace(/[-_]/g, ' ');
    const resolvedLabel = typeLabels[normalizedValue] ?? fallbackLabel;
    const label = resolvedLabel
      ? `${resolvedLabel[0].toUpperCase()}${resolvedLabel.slice(1)}`
      : token;
    filterLabelCache.set(token, label);
    return label;
  };

  const resolveQuickLaunchToy = (list, query) => {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery || list.length === 0) return null;

    const exactMatch = list.find((toy) => {
      const slug = toy.slug?.toLowerCase() ?? '';
      const title = toy.title?.toLowerCase() ?? '';
      return slug === trimmedQuery || title === trimmedQuery;
    });

    if (exactMatch) return exactMatch;
    if (list.length === 1) return list[0];
    return null;
  };

  const updateSearchMetaNote = () => {
    const note = ensureSearchMetaNote();
    if (!(note instanceof HTMLElement)) return;

    const baseActiveLabels = getState()
      .filters.filter(
        (token) =>
          token.startsWith('mood:') || token === 'capability:microphone',
      )
      .map((token) => formatTokenLabel(token))
      .slice(0, 2);

    if (baseActiveLabels.length === 0) {
      note.textContent =
        'Press / to search, then press Enter to launch a single matching visual.';
      return;
    }

    note.textContent = `Quick filters active: ${baseActiveLabels.join(' + ')}. Press / to search.`;
  };

  const updateSearchClearState = () => {
    const clearButton = ensureSearchClearButton();
    if (!(clearButton instanceof HTMLButtonElement)) return;
    const hasQuery = getState().query.trim().length > 0;
    clearButton.disabled = !hasQuery;
    clearButton.setAttribute('aria-disabled', String(!hasQuery));
  };

  const updateFilterResetState = () => {
    const resetButton = ensureFilterResetButton();
    if (!(resetButton instanceof HTMLButtonElement)) return;
    const state = getState();
    const hasRefinements =
      state.filters.length > 0 ||
      state.sort !== defaultSort ||
      state.query.trim().length > 0;
    resetButton.disabled = !hasRefinements;
    resetButton.setAttribute('aria-disabled', String(!hasRefinements));
  };

  const updateFilterChipA11y = (chip, isActive) => {
    if (!chip || typeof chip.setAttribute !== 'function') return;
    chip.setAttribute('aria-pressed', String(isActive));
  };

  const resolveChipToken = (chip) => {
    if (!(chip instanceof HTMLElement)) return null;
    const type = chip.getAttribute('data-filter-type');
    const value = chip.getAttribute('data-filter-value');
    if (!type || !value) return null;
    return createFilterToken(type, value);
  };

  const setChipActiveState = (chip, isActive) => {
    if (!(chip instanceof HTMLElement)) return;
    chip.classList.toggle('is-active', isActive);
    updateFilterChipA11y(chip, isActive);
  };

  const syncFilterTokenState = (token, isActive) => {
    document.querySelectorAll('[data-filter-chip]').forEach((chip) => {
      if (resolveChipToken(chip) !== token) return;
      setChipActiveState(chip, isActive);
    });
  };

  const syncAllFilterChips = () => {
    const activeFilters = new Set(getState().filters);
    ensureFilterChips().forEach((chip) => {
      const token = resolveChipToken(chip);
      if (!token) return;
      setChipActiveState(chip, activeFilters.has(token));
    });
  };

  const updateResultsMeta = (visibleCount) => {
    const meta = ensureMetaNode();
    if (!meta) return;

    const state = getState();
    const parts = [`${visibleCount} results`];

    if (state.filters.length > 0) {
      parts.push(
        `${state.filters.length} filter${state.filters.length === 1 ? '' : 's'}`,
      );
    }

    if (state.sort !== defaultSort) {
      parts.push(getSortLabel());
    }

    const quickLaunchToy = resolveQuickLaunchToy(
      getLastFilteredToys(),
      state.query,
    );
    if (quickLaunchToy) {
      parts.push(`↵ Launch ${quickLaunchToy.title}`);
    }

    meta.textContent = parts.join(' • ');
  };

  const updateActiveFiltersSummary = ({
    emitFilterStateChange,
    commitAndRender,
  }) => {
    const summary = ensureActiveFiltersSummary();
    if (!(summary instanceof HTMLElement)) return;

    const state = getState();
    const hasQuery = state.query.trim().length > 0;
    const hasTokens = state.filters.length > 0;
    const hasSort = state.sort !== defaultSort;
    const canClear = hasTokens || hasSort || hasQuery;

    const chipItems = [
      ...(hasQuery
        ? [
            {
              label: `Search: ${state.query.trim()}`,
              onClick: () => clearSearch(),
            },
          ]
        : []),
      ...state.filters.map((token) => ({
        label: formatTokenLabel(token),
        onClick: () => {
          removeFilterToken(token);
          emitFilterStateChange();
          commitAndRender({ replace: false });
        },
      })),
      ...(hasSort
        ? [
            {
              label: `Sort: ${getSortLabel()}`,
              onClick: () => {
                resetSort();
                commitAndRender({ replace: false });
              },
            },
          ]
        : []),
    ];

    const summaryTextParts = [];
    if (hasQuery) {
      summaryTextParts.push(`Search: ${state.query.trim()}`);
    }
    if (hasTokens) {
      summaryTextParts.push(
        `Filters: ${state.filters.map((token) => formatTokenLabel(token)).join(', ')}`,
      );
    }
    if (hasSort) {
      summaryTextParts.push(`Sort: ${getSortLabel()}`);
    }

    summary.hidden = false;
    summary.setAttribute('aria-hidden', 'false');
    summary.classList.toggle('is-empty', !canClear);

    const status = ensureActiveFiltersStatus();
    if (status instanceof HTMLElement) {
      status.textContent =
        summaryTextParts.join(' • ') || 'Showing all visualizers';
    }

    const chips = ensureActiveFiltersChips();
    if (chips instanceof HTMLElement) {
      chips.replaceChildren();
      chipItems.forEach(({ label, onClick }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'active-filter-chip';
        button.textContent = label;
        button.setAttribute('aria-label', `Remove ${label}`);
        button.addEventListener('click', onClick);
        chips.appendChild(button);
      });
      chips.hidden = chipItems.length === 0;
    }

    const clearButton = ensureActiveFiltersClear();
    if (clearButton instanceof HTMLButtonElement) {
      clearButton.disabled = !canClear;
      clearButton.setAttribute('aria-disabled', String(!canClear));
    }

    updateSearchMetaNote();
  };

  const syncRefineDisclosure = () => {
    const refine = ensureLibraryRefine();
    if (!(refine instanceof HTMLElement) || refine.tagName !== 'DETAILS')
      return;
    const summary = refine.querySelector('summary');
    const state = getState();
    const hasActiveRefinement =
      state.query.trim().length > 0 ||
      state.filters.length > 0 ||
      state.sort !== defaultSort;

    if (hasActiveRefinement) {
      refine.open = true;
      if (summary instanceof HTMLElement) {
        summary.textContent = 'Hide filters';
      }
      return;
    }

    const shouldCollapseByViewport =
      windowObject &&
      typeof windowObject.matchMedia === 'function' &&
      windowObject.matchMedia('(max-width: 520px)').matches;

    refine.open = !shouldCollapseByViewport;
    if (summary instanceof HTMLElement) {
      summary.textContent = refine.open
        ? 'Hide all filters'
        : 'Show all filters';
    }
  };

  const syncStateToInputs = () => {
    const state = getState();
    const search = getSearchInput();
    if (search && 'value' in search) {
      search.value = state.query;
    }

    const sortControl = ensureSortControl();
    if (sortControl instanceof HTMLSelectElement) {
      sortControl.value = state.sort;
    }

    syncAllFilterChips();
    updateSearchClearState();
    updateFilterResetState();
  };

  return {
    formatTokenLabel,
    resolveChipToken,
    resolveQuickLaunchToy,
    setChipActiveState,
    syncFilterTokenState,
    syncAllFilterChips,
    syncRefineDisclosure,
    syncStateToInputs,
    updateActiveFiltersSummary,
    updateFilterChipA11y,
    updateFilterResetState,
    updateResultsMeta,
    updateSearchClearState,
  };
}
