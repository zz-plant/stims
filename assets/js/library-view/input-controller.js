export const createLibraryInputController = ({
  document,
  searchInputId,
  getState,
  ensureSearchForm,
  ensureSearchClearButton,
  ensureFilterResetButton,
  ensureSearchSuggestions,
  ensureActiveFiltersClear,
  ensureLibraryRefine,
  ensureSortControl,
  ensureFilterChips,
  updateFilterChipA11y,
  resolveChipToken,
  filterLabelCache,
  onSearchInput,
  onSearchBlur,
  onSearchClear,
  onSearchSubmit,
  onSearchQuickLaunch,
  onSearchFocusShortcut,
  onEscapeShortcut,
  onFilterChipToggle,
  onSortChange,
  onResetFilters,
}) => {
  let initialized = false;
  let cleanup = null;

  const dispose = () => {
    if (!cleanup) {
      initialized = false;
      return;
    }

    const nextCleanup = cleanup;
    cleanup = null;
    initialized = false;
    nextCleanup();
  };

  const init = () => {
    if (initialized && cleanup) {
      return cleanup;
    }

    const chips = ensureFilterChips();
    chips.forEach((chip) => {
      updateFilterChipA11y(chip, chip.classList.contains('is-active'));
      const token = resolveChipToken(chip);
      if (!token) return;
      const label = chip.textContent?.trim();
      if (label) {
        filterLabelCache.set(token, label);
      }
    });

    const disposers = [];
    const registerDisposer = (disposer) => {
      disposers.push(disposer);
    };
    const handleFilterChipClick = (event) => {
      const target = event.target;
      if (!(target && typeof target === 'object' && 'closest' in target))
        return;
      const chip = target.closest?.('[data-filter-chip]');
      if (!(chip instanceof HTMLElement)) return;
      onFilterChipToggle(chip);
    };

    document.addEventListener('click', handleFilterChipClick);
    registerDisposer(() => {
      document.removeEventListener('click', handleFilterChipClick);
    });

    const search = searchInputId
      ? document.getElementById(searchInputId)
      : null;

    if (search instanceof HTMLInputElement) {
      if (!search.placeholder) {
        search.placeholder = 'Search visuals, moods, audio modes, or controls';
      }
      search.setAttribute(
        'aria-label',
        'Search visuals by title, mood, audio mode, or interaction',
      );
      search.setAttribute('list', ensureSearchSuggestions()?.id ?? '');
    }

    if (search) {
      const handleSearchInput = (event) => {
        onSearchInput(event.target.value);
      };
      const handleSearchBlur = () => {
        onSearchBlur();
      };
      const handleSearchKeydown = (event) => {
        if (event.key === 'Escape') {
          if (getState().query.trim().length > 0) {
            event.preventDefault();
            onSearchClear();
          }
          return;
        }

        const isPlainEnter =
          event.key === 'Enter' &&
          !event.shiftKey &&
          !event.altKey &&
          !event.metaKey &&
          !event.ctrlKey;
        if (!isPlainEnter) return;
        if (!onSearchQuickLaunch()) return;
        event.preventDefault();
      };

      search.addEventListener('input', handleSearchInput);
      search.addEventListener('blur', handleSearchBlur);
      search.addEventListener('keydown', handleSearchKeydown);
      registerDisposer(() => {
        search.removeEventListener('input', handleSearchInput);
        search.removeEventListener('blur', handleSearchBlur);
        search.removeEventListener('keydown', handleSearchKeydown);
      });
    }

    const form = ensureSearchForm();
    if (form) {
      const handleSearchSubmit = (event) => {
        event.preventDefault();
        onSearchSubmit();
      };
      form.addEventListener('submit', handleSearchSubmit);
      registerDisposer(() => {
        form.removeEventListener('submit', handleSearchSubmit);
      });
    }

    const clearButton = ensureSearchClearButton();
    if (clearButton instanceof HTMLButtonElement) {
      clearButton.addEventListener('click', onSearchClear);
      registerDisposer(() => {
        clearButton.removeEventListener('click', onSearchClear);
      });
    }

    const isEditableTarget = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target instanceof HTMLInputElement) return true;
      if (target instanceof HTMLTextAreaElement) return true;
      return target.isContentEditable;
    };

    const focusSearch = () => {
      if (!(search instanceof HTMLInputElement)) return;
      search.focus();
      search.select();
      onSearchFocusShortcut();
    };

    const handleDocumentKeydown = (event) => {
      const target = event.target;
      const isMetaShortcut =
        event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
      const isSlashShortcut =
        event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isEscapeShortcut = event.key === 'Escape';

      if (isMetaShortcut && !isEditableTarget(target)) {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (isSlashShortcut && !isEditableTarget(target)) {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (isEscapeShortcut && !isEditableTarget(target)) {
        const state = getState();
        if (state.query.trim().length > 0 || state.filters.length > 0) {
          event.preventDefault();
          onEscapeShortcut();
        }
      }
    };

    document.addEventListener('keydown', handleDocumentKeydown);
    registerDisposer(() => {
      document.removeEventListener('keydown', handleDocumentKeydown);
    });

    const sortControl = ensureSortControl();
    if (sortControl instanceof HTMLSelectElement) {
      const handleSortChange = () => {
        onSortChange(sortControl.value);
      };
      sortControl.addEventListener('change', handleSortChange);
      registerDisposer(() => {
        sortControl.removeEventListener('change', handleSortChange);
      });
    }

    const resetButton = ensureFilterResetButton();
    if (resetButton instanceof HTMLButtonElement) {
      resetButton.addEventListener('click', onResetFilters);
      registerDisposer(() => {
        resetButton.removeEventListener('click', onResetFilters);
      });
    }

    const clearActiveFilters = ensureActiveFiltersClear();
    if (
      clearActiveFilters instanceof HTMLButtonElement &&
      clearActiveFilters !== resetButton
    ) {
      clearActiveFilters.addEventListener('click', onResetFilters);
      registerDisposer(() => {
        clearActiveFilters.removeEventListener('click', onResetFilters);
      });
    }

    const refine = ensureLibraryRefine();
    if (refine instanceof HTMLDetailsElement) {
      const handleToggle = () => {
        const summary = refine.querySelector('summary');
        if (!(summary instanceof HTMLElement)) return;
        summary.textContent = refine.open
          ? 'Hide all filters'
          : 'Show all filters';
      };
      refine.addEventListener('toggle', handleToggle);
      registerDisposer(() => {
        refine.removeEventListener('toggle', handleToggle);
      });
    }

    cleanup = () => {
      while (disposers.length > 0) {
        const disposer = disposers.pop();
        try {
          disposer?.();
        } catch (error) {
          console.warn('Failed to dispose library input controller', error);
        }
      }
      initialized = false;
    };

    initialized = true;
    return cleanup;
  };

  return {
    init,
    dispose,
  };
};
