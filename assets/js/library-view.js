import { createLibraryCardRenderer } from './library-view/card-renderer.js';
import { createLibraryDomCache } from './library-view/dom-cache.js';
import {
  createFilterToken,
  normalizeFilterToken,
} from './library-view/filter-state.js';
import { createLibraryInputController } from './library-view/input-controller.js';
import { createLibraryListRenderer } from './library-view/render-list.js';
import {
  computeFilteredToys,
  createLibraryStateController,
  createToySearchMetadataMap,
  DEFAULT_LIBRARY_SORT,
  getMatchedFields,
  getQueryTokens,
} from './library-view/state-controller.js';
import { setupDarkModeToggle } from './library-view/theme-toggle.js';
import { getToyRouteHref } from './router.ts';
import { getRecentToySlugs } from './utils/growth-metrics.ts';

const createNoopThreeEffects = () => ({
  init() {},
  syncCardPreviews() {},
  triggerLaunchTransition() {},
  startLaunchTransition() {},
  dispose() {},
});

export function createLibraryView({
  toys = [],
  loadToy,
  initNavigation,
  loadFromQuery,
  targetId = 'toy-list',
  searchInputId,
  cardElement = 'a',
  enableIcons = false,
  enableCapabilityBadges = false,
  enableKeyboardHandlers = false,
  enableDarkModeToggle = false,
  themeToggleId = 'theme-toggle',
} = {}) {
  const STORAGE_KEY = 'stims-library-state';
  const COMPATIBILITY_MODE_KEY = 'stims-compatibility-mode';
  const stateController = createLibraryStateController({
    storageKey: STORAGE_KEY,
    compatibilityModeKey: COMPATIBILITY_MODE_KEY,
  });

  let allToys = toys;
  let originalOrder = new Map();
  let lastCommittedQuery = '';
  let pendingRenderFrame = 0;
  let lastFilteredToys = [];
  let suggestionSignature = '';
  let toyBySlug = new Map();
  let toySearchMetadata = new Map();
  let threeEffects = createNoopThreeEffects();
  let threeEffectsLoader = null;
  let threeEffectsInitialized = false;
  const filterLabelCache = new Map();

  const {
    ensureMetaNode,
    ensureSearchForm,
    ensureSearchClearButton,
    ensureFilterResetButton,
    ensureSearchSuggestions,
    ensureActiveFiltersSummary,
    ensureActiveFiltersChips,
    ensureActiveFiltersClear,
    ensureActiveFiltersStatus,
    ensureSearchMetaNote,
    ensureLibraryRefine,
    ensureSortControl,
    ensureFilterChips,
  } = createLibraryDomCache(document);

  const getState = () => stateController.getState();
  const getToyKey = (toy, index = 0) => toy?.slug ?? `toy-${index}`;

  const ensureThreeEffects = async () => {
    if (threeEffectsLoader) return threeEffectsLoader;
    threeEffectsLoader = import('./library-view/three-library-effects.ts')
      .then(({ createLibraryThreeEffects }) => {
        threeEffects = createLibraryThreeEffects();
        if (threeEffectsInitialized) {
          threeEffects.init();
        }
        return threeEffects;
      })
      .catch((error) => {
        console.warn('Failed to initialize library Three.js effects', error);
        threeEffects = createNoopThreeEffects();
        return threeEffects;
      });
    return threeEffectsLoader;
  };

  const requestThreeEffects = () => {
    if (typeof window === 'undefined') return;
    const start = () => {
      void ensureThreeEffects();
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(start, { timeout: 600 });
      return;
    }
    window.setTimeout(start, 120);
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
      state.sort !== DEFAULT_LIBRARY_SORT;

    if (hasActiveRefinement) {
      refine.open = true;
      if (summary instanceof HTMLElement) {
        summary.textContent = 'Hide filters';
      }
      return;
    }

    const shouldCollapseByViewport =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 520px)').matches;

    refine.open = !shouldCollapseByViewport;
    if (summary instanceof HTMLElement) {
      summary.textContent = refine.open
        ? 'Hide all filters'
        : 'Show all filters';
    }
  };

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
      state.sort !== DEFAULT_LIBRARY_SORT ||
      state.query.trim().length > 0;
    resetButton.disabled = !hasRefinements;
    resetButton.setAttribute('aria-disabled', String(!hasRefinements));
  };

  const emitFilterStateChange = () => {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new Event('library:filters-changed'));
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

    if (state.sort !== DEFAULT_LIBRARY_SORT) {
      parts.push(getSortLabel());
    }

    const quickLaunchToy = resolveQuickLaunchToy(lastFilteredToys, state.query);
    if (quickLaunchToy) {
      parts.push(`↵ Launch ${quickLaunchToy.title}`);
    }

    meta.textContent = parts.join(' • ');
  };

  const updateActiveFiltersSummary = () => {
    const summary = ensureActiveFiltersSummary();
    if (!(summary instanceof HTMLElement)) return;

    const state = getState();
    const hasQuery = state.query.trim().length > 0;
    const hasTokens = state.filters.length > 0;
    const hasSort = state.sort !== DEFAULT_LIBRARY_SORT;
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
          const result = stateController.toggleFilter(token);
          if (!result.token) return;
          syncFilterTokenState(result.token, result.isActive);
          emitFilterStateChange();
          commitAndRender({ replace: false });
        },
      })),
      ...(hasSort
        ? [
            {
              label: `Sort: ${getSortLabel()}`,
              onClick: () => {
                stateController.setSort(DEFAULT_LIBRARY_SORT);
                const sortControl = ensureSortControl();
                if (sortControl instanceof HTMLSelectElement) {
                  sortControl.value = DEFAULT_LIBRARY_SORT;
                }
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

  const computeAndApplyFilters = () => {
    const nextList = computeFilteredToys({
      toys: allToys,
      state: getState(),
      metadataByKey: toySearchMetadata,
      getToyKey,
      originalOrder,
    });
    lastFilteredToys = nextList;
    updateResultsMeta(nextList.length);
    return nextList;
  };

  const syncStateToInputs = () => {
    const state = getState();
    if (searchInputId) {
      const search = document.getElementById(searchInputId);
      if (search && 'value' in search) {
        search.value = state.query;
      }
    }

    const sortControl = ensureSortControl();
    if (sortControl instanceof HTMLSelectElement) {
      sortControl.value = state.sort;
    }

    syncAllFilterChips();
    updateSearchClearState();
    updateFilterResetState();
    updateActiveFiltersSummary();
  };

  const openToy = (
    toy,
    { preferDemoAudio = false, launchCard = null } = {},
  ) => {
    threeEffects.triggerLaunchTransition();
    threeEffects.startLaunchTransition(launchCard);
    if (toy.type === 'module' && typeof loadToy === 'function') {
      loadToy(toy.slug, { pushState: true, preferDemoAudio });
    } else if (toy.module) {
      window.location.href = toy.module;
    }
  };

  const handleOpenToy = (toy, event) => {
    const isMouseEvent =
      typeof MouseEvent !== 'undefined' && event instanceof MouseEvent;
    const isModifiedClick = isMouseEvent
      ? event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button === 1
      : false;

    if (cardElement === 'a' && event) {
      if (isModifiedClick) return;
      event.preventDefault();
    }

    const launchCard =
      event?.currentTarget instanceof HTMLElement
        ? event.currentTarget.closest('.webtoy-card')
        : null;
    void openToy(toy, { launchCard });
  };

  const renderGrowthPanels = (listElement) => {
    if (!listElement || typeof listElement.appendChild !== 'function') return;

    const recentSlugs = getRecentToySlugs(3);
    const recentToys = recentSlugs
      .map((slug) => toyBySlug.get(slug))
      .filter(Boolean);

    if (recentToys.length > 0) {
      const panel = document.createElement('section');
      panel.className = 'webtoy-growth-panel';

      const heading = document.createElement('h3');
      heading.className = 'webtoy-growth-panel__title';
      heading.textContent = 'Pick up where you left off';
      panel.appendChild(heading);

      const list = document.createElement('div');
      list.className = 'webtoy-card-actions';
      recentToys.forEach((toy) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cta-button cta-button--muted';
        button.textContent = toy.title;
        button.addEventListener('click', () => {
          void openToy(toy);
        });
        list.appendChild(button);
      });
      panel.appendChild(list);
      listElement.appendChild(panel);
    }
  };

  const createEmptyState = () => {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.setAttribute('role', 'status');
    emptyState.setAttribute('aria-live', 'polite');

    const message = document.createElement('p');
    message.className = 'empty-state__message';
    message.textContent =
      'No visuals match your search or filters. Try clearing your search or removing filters.';

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'cta-button';
    resetButton.textContent = 'Reset view';
    resetButton.addEventListener('click', () => resetFiltersAndSearch());

    const quickActions = document.createElement('div');
    quickActions.className = 'webtoy-card-actions';

    const applySuggestedState = ({ query = '', filters = [] }) => {
      stateController.setState({ query, filters, sort: DEFAULT_LIBRARY_SORT });
      syncStateToInputs();
      renderCurrentState();
      stateController.commitState({ replace: false });
    };

    [
      { label: 'Show demo-ready', query: 'demo audio' },
      { label: 'Show mobile-friendly', query: 'mobile' },
      { label: 'Show broader device support', filters: ['feature:compatible'] },
    ].forEach(({ label, query, filters }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cta-button cta-button--muted';
      button.textContent = label;
      button.addEventListener('click', () =>
        applySuggestedState({ query, filters }),
      );
      quickActions.appendChild(button);
    });

    const collapseSuggestions =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 600px)').matches;

    emptyState.append(message, resetButton);

    if (collapseSuggestions) {
      const suggestionsDisclosure = document.createElement('details');
      suggestionsDisclosure.className = 'empty-state__suggestions';

      const summary = document.createElement('summary');
      summary.textContent = 'Try suggestions';

      suggestionsDisclosure.append(summary, quickActions);
      emptyState.appendChild(suggestionsDisclosure);
    } else {
      emptyState.appendChild(quickActions);
    }

    return emptyState;
  };

  const cardRenderer = createLibraryCardRenderer({
    document,
    cardElement,
    enableIcons,
    enableCapabilityBadges,
    getToyHref: (toy) =>
      toy.type === 'module' ? getToyRouteHref(toy.slug) : toy.module,
    getMatchedFields: (toy, queryTokens) =>
      getMatchedFields(toy, queryTokens, toySearchMetadata, getToyKey),
    openToy,
  });

  const listRenderer = createLibraryListRenderer({
    document,
    targetId,
    getToyKey,
    createCard: (toy, queryTokens) => cardRenderer.createCard(toy, queryTokens),
    renderGrowthPanels,
    createEmptyState,
    onCardsRendered: (cards, renderedToys) => {
      threeEffects.syncCardPreviews(cards, renderedToys);
      updateResultsMeta(lastFilteredToys.length);
      updateActiveFiltersSummary();
    },
  });

  const renderCurrentState = () => {
    const state = getState();
    const listToRender = computeAndApplyFilters();
    listRenderer.render({
      listToRender,
      query: state.query,
      queryTokens: getQueryTokens(state.query),
    });
  };

  const commitAndRender = ({ replace }) => {
    stateController.commitState({ replace });
    syncRefineDisclosure();
    renderCurrentState();
    updateSearchClearState();
    updateFilterResetState();
    updateActiveFiltersSummary();
    lastCommittedQuery = getState().query.trim();
  };

  const scheduleRender = () => {
    if (pendingRenderFrame) return;

    const commitRender = () => {
      pendingRenderFrame = 0;
      renderCurrentState();
      updateSearchClearState();
      updateActiveFiltersSummary();
    };

    if (
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'
    ) {
      pendingRenderFrame = window.requestAnimationFrame(commitRender);
      return;
    }

    pendingRenderFrame = globalThis.setTimeout(commitRender, 16);
  };

  const filterToys = (query) => {
    stateController.applyQuery(query);
    computeAndApplyFilters();
    syncRefineDisclosure();
    scheduleRender();
  };

  const clearSearch = () => {
    stateController.applyQuery('');
    syncStateToInputs();
    stateController.commitState({ replace: false });
    syncRefineDisclosure();
    renderCurrentState();
  };

  const resetFiltersAndSearch = () => {
    stateController.clearState();
    emitFilterStateChange();
    syncStateToInputs();
    stateController.commitState({ replace: false });
    syncRefineDisclosure();
    renderCurrentState();
  };

  const clearAllFilters = () => {
    resetFiltersAndSearch();
  };

  const populateSearchSuggestions = () => {
    const datalist = ensureSearchSuggestions();
    if (!datalist) return;
    const nextSuggestionSignature = allToys
      .map((toy) => toy.slug ?? toy.title ?? '')
      .join('|');
    if (nextSuggestionSignature === suggestionSignature) return;
    suggestionSignature = nextSuggestionSignature;

    const suggestions = new Set();
    allToys.forEach((toy) => {
      if (toy.title) suggestions.add(toy.title);
      if (toy.slug) suggestions.add(toy.slug);
      (toy.tags ?? []).forEach((tag) => suggestions.add(tag));
      (toy.moods ?? []).forEach((mood) => suggestions.add(mood));
      if (toy.capabilities?.microphone) suggestions.add('microphone');
      if (toy.capabilities?.demoAudio) suggestions.add('demo audio');
      if (toy.capabilities?.motion) suggestions.add('motion');
      if (toy.requiresWebGPU) suggestions.add('webgpu');
    });
    const fragment = document.createDocumentFragment();
    Array.from(suggestions)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .forEach((suggestion) => {
        const option = document.createElement('option');
        option.value = suggestion;
        fragment.appendChild(option);
      });
    datalist.replaceChildren(fragment);
  };

  const setToys = (nextToys = []) => {
    allToys = nextToys;
    originalOrder = new Map(
      nextToys.map((toy, index) => [getToyKey(toy, index), index]),
    );
    toyBySlug = new Map(
      nextToys.filter((toy) => toy.slug).map((toy) => [toy.slug, toy]),
    );
    toySearchMetadata = createToySearchMetadataMap(nextToys, getToyKey);
    populateSearchSuggestions();
  };

  const applyState = (state, { render = true } = {}) => {
    stateController.setState({
      query: state.query,
      filters: (state.filters ?? []).map((token) =>
        normalizeFilterToken(token),
      ),
      sort: state.sort ?? DEFAULT_LIBRARY_SORT,
    });
    lastCommittedQuery = getState().query.trim();
    emitFilterStateChange();
    syncStateToInputs();
    if (render) {
      renderCurrentState();
    } else {
      computeAndApplyFilters();
    }
  };

  const toggleFilterChip = (chip) => {
    const token = resolveChipToken(chip);
    if (!token) return;
    const result = stateController.toggleFilter(token);
    if (!result.token) return;
    emitFilterStateChange();
    syncFilterTokenState(result.token, result.isActive);
    stateController.commitState({ replace: false });
    renderCurrentState();
    updateFilterResetState();
    updateActiveFiltersSummary();
  };

  const initCardClickHandlers = () => {
    const list = document.getElementById(targetId);
    if (!list) return;
    list.addEventListener('click', (event) => {
      const target =
        event.target && typeof event.target === 'object' ? event.target : null;
      const card =
        target && 'closest' in target ? target.closest?.('.webtoy-card') : null;
      if (!(card instanceof HTMLElement)) return;
      const slug = card.dataset.toySlug;
      if (!slug) return;
      const toy = toyBySlug.get(slug);
      if (!toy) return;
      handleOpenToy(toy, event);
    });
    if (enableKeyboardHandlers) {
      list.addEventListener('keydown', (event) => {
        const target =
          event.target && typeof event.target === 'object'
            ? event.target
            : null;
        const card =
          target && 'closest' in target
            ? target.closest?.('.webtoy-card')
            : null;
        if (!(card instanceof HTMLElement)) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (
          target instanceof HTMLElement &&
          target !== card &&
          target.closest('button, a, input, select, textarea, summary')
        ) {
          return;
        }
        const slug = card.dataset.toySlug;
        if (!slug) return;
        const toy = toyBySlug.get(slug);
        if (!toy) return;
        event.preventDefault();
        handleOpenToy(toy, event);
      });
    }
  };

  const inputController = createLibraryInputController({
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
    onSearchInput(query) {
      filterToys(query);
      stateController.commitState({ replace: true });
    },
    onSearchBlur() {
      if (getState().query.trim() !== lastCommittedQuery) {
        lastCommittedQuery = getState().query.trim();
        stateController.commitState({ replace: false });
      }
    },
    onSearchClear() {
      clearSearch();
    },
    onSearchSubmit() {},
    onSearchQuickLaunch() {
      const quickLaunchToy = resolveQuickLaunchToy(
        lastFilteredToys,
        getState().query,
      );
      if (!quickLaunchToy) return false;
      void openToy(quickLaunchToy);
      return true;
    },
    onSearchFocusShortcut() {},
    onEscapeShortcut() {
      clearAllFilters();
    },
    onFilterChipToggle(chip) {
      toggleFilterChip(chip);
    },
    onSortChange(sort) {
      stateController.setSort(sort);
      stateController.commitState({ replace: false });
      renderCurrentState();
      updateFilterResetState();
      updateActiveFiltersSummary();
    },
    onResetFilters() {
      resetFiltersAndSearch();
    },
  });

  const init = async () => {
    setToys(allToys);
    const initialState = stateController.restoreInitialState();
    const hasStoredOnlyState =
      initialState.query.trim().length > 0 ||
      initialState.filters.length > 0 ||
      initialState.sort !== DEFAULT_LIBRARY_SORT;
    applyState(initialState, { render: false });
    if (hasStoredOnlyState && window.location.search !== '') {
      lastCommittedQuery = getState().query.trim();
    } else if (hasStoredOnlyState) {
      stateController.commitState({ replace: true });
    }

    syncRefineDisclosure();
    threeEffectsInitialized = true;
    renderCurrentState();
    requestThreeEffects();

    if (enableDarkModeToggle) {
      setupDarkModeToggle(themeToggleId);
    }

    inputController.init();
    if (typeof initNavigation === 'function') {
      initNavigation();
    }
    initCardClickHandlers();
    if (typeof loadFromQuery === 'function') {
      await loadFromQuery();
    }

    window.addEventListener('popstate', () => {
      const nextState = stateController.readStateFromUrl();
      applyState(nextState, { render: true });
      syncRefineDisclosure();
    });

    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function'
    ) {
      const narrowViewportQuery = window.matchMedia('(max-width: 680px)');
      const handleViewportChange = () => syncRefineDisclosure();
      if (typeof narrowViewportQuery.addEventListener === 'function') {
        narrowViewportQuery.addEventListener('change', handleViewportChange);
      } else if (typeof narrowViewportQuery.addListener === 'function') {
        narrowViewportQuery.addListener(handleViewportChange);
      }
    }
  };

  return {
    init,
    setToys,
    renderToys: renderCurrentState,
    filterToys,
  };
}
