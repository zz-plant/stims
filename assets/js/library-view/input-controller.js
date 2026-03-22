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
}) => ({
  init() {
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

    const FILTER_DELEGATE_KEY = '__stimsLibraryFilterDelegate';
    const previousDelegate = document[FILTER_DELEGATE_KEY];
    if (typeof previousDelegate === 'function') {
      document.removeEventListener('click', previousDelegate);
    }

    const handleFilterChipClick = (event) => {
      const target = event.target;
      if (!(target && typeof target === 'object' && 'closest' in target))
        return;
      const chip = target.closest?.('[data-filter-chip]');
      if (!(chip instanceof HTMLElement)) return;
      onFilterChipToggle(chip);
    };

    document[FILTER_DELEGATE_KEY] = handleFilterChipClick;
    document.addEventListener('click', handleFilterChipClick);

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
      search.addEventListener('input', (event) => {
        onSearchInput(event.target.value);
      });
      search.addEventListener('blur', onSearchBlur);
      search.addEventListener('keydown', (event) => {
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
      });
    }

    const form = ensureSearchForm();
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        onSearchSubmit();
      });
    }

    const clearButton = ensureSearchClearButton();
    if (clearButton instanceof HTMLButtonElement) {
      clearButton.addEventListener('click', onSearchClear);
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

    document.addEventListener('keydown', (event) => {
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
    });

    const sortControl = ensureSortControl();
    if (sortControl instanceof HTMLSelectElement) {
      sortControl.addEventListener('change', () => {
        onSortChange(sortControl.value);
      });
    }

    const resetButton = ensureFilterResetButton();
    if (resetButton instanceof HTMLButtonElement) {
      resetButton.addEventListener('click', onResetFilters);
    }

    const clearActiveFilters = ensureActiveFiltersClear();
    if (
      clearActiveFilters instanceof HTMLButtonElement &&
      clearActiveFilters !== resetButton
    ) {
      clearActiveFilters.addEventListener('click', onResetFilters);
    }

    const refine = ensureLibraryRefine();
    if (refine instanceof HTMLDetailsElement) {
      refine.addEventListener('toggle', () => {
        const summary = refine.querySelector('summary');
        if (!(summary instanceof HTMLElement)) return;
        summary.textContent = refine.open
          ? 'Hide all filters'
          : 'Show all filters';
      });
    }
  },
});
