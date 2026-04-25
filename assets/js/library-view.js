import { createLibraryCardRenderer } from './library-view/card-renderer.js';
import { createLibraryDomCache } from './library-view/dom-cache.js';
import { createLibraryFilterPresenter } from './library-view/filter-presenter.js';
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
import { createLibraryThreeEffectsManager } from './library-view/three-effects-manager.js';
import { getRecentToySlugs } from './utils/growth-metrics.ts';
import { getToyRouteHref } from './utils/toy-route-href.ts';

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
  let pendingRenderFrameScheduler = null;
  let initPromise = null;
  let initToken = 0;
  let disposed = false;
  const cleanupStack = [];

  const registerCleanup = (cleanup) => {
    if (typeof cleanup === 'function') {
      cleanupStack.push(cleanup);
    }
    return cleanup;
  };

  const runCleanupStack = () => {
    while (cleanupStack.length > 0) {
      const cleanup = cleanupStack.pop();
      try {
        cleanup?.();
      } catch (error) {
        console.warn('Failed to dispose library view cleanup', error);
      }
    }
  };

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

  const emitFilterStateChange = () => {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new Event('library:filters-changed'));
  };
  const threeEffectsManager = createLibraryThreeEffectsManager();
  const filterPresenter = createLibraryFilterPresenter({
    document,
    createFilterToken,
    defaultSort: DEFAULT_LIBRARY_SORT,
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
    getLastFilteredToys: () => lastFilteredToys,
    getSearchInput: () =>
      searchInputId ? document.getElementById(searchInputId) : null,
    clearSearch: () => clearSearch(),
    removeFilterToken: (token) => {
      const result = stateController.toggleFilter(token);
      if (!result.token) return;
      filterPresenter.syncFilterTokenState(result.token, result.isActive);
    },
    resetSort: () => {
      stateController.setSort(DEFAULT_LIBRARY_SORT);
      const sortControl = ensureSortControl();
      if (sortControl instanceof HTMLSelectElement) {
        sortControl.value = DEFAULT_LIBRARY_SORT;
      }
    },
  });

  const computeAndApplyFilters = () => {
    const nextList = computeFilteredToys({
      toys: allToys,
      state: getState(),
      metadataByKey: toySearchMetadata,
      getToyKey,
      originalOrder,
    });
    lastFilteredToys = nextList;
    filterPresenter.updateResultsMeta(nextList.length);
    return nextList;
  };

  const openToy = (
    toy,
    { preferDemoAudio = false, launchCard = null } = {},
  ) => {
    threeEffectsManager.triggerLaunchTransition();
    threeEffectsManager.startLaunchTransition(launchCard);
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
      threeEffectsManager.syncCardPreviews(cards, renderedToys);
      filterPresenter.updateResultsMeta(lastFilteredToys.length);
      filterPresenter.updateActiveFiltersSummary({
        emitFilterStateChange,
        commitAndRender,
      });
    },
  });

  const renderCurrentState = () => {
    if (disposed) return;
    const state = getState();
    const listToRender = computeAndApplyFilters();
    listRenderer.render({
      listToRender,
      query: state.query,
      queryTokens: getQueryTokens(state.query),
    });
  };

  const commitAndRender = ({ replace }) => {
    if (disposed) return;
    stateController.commitState({ replace });
    filterPresenter.syncRefineDisclosure();
    renderCurrentState();
    filterPresenter.updateSearchClearState();
    filterPresenter.updateFilterResetState();
    filterPresenter.updateActiveFiltersSummary({
      emitFilterStateChange,
      commitAndRender,
    });
    lastCommittedQuery = getState().query.trim();
  };

  const scheduleRender = () => {
    if (disposed || pendingRenderFrameScheduler) return;

    if (pendingRenderFrame) return;

    const commitRender = () => {
      pendingRenderFrame = 0;
      pendingRenderFrameScheduler = null;
      if (disposed) return;
      renderCurrentState();
      filterPresenter.updateSearchClearState();
      filterPresenter.updateActiveFiltersSummary({
        emitFilterStateChange,
        commitAndRender,
      });
    };

    if (
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'
    ) {
      pendingRenderFrameScheduler = 'raf';
      pendingRenderFrame = window.requestAnimationFrame(commitRender);
      return;
    }

    pendingRenderFrameScheduler = 'timeout';
    pendingRenderFrame = globalThis.setTimeout(commitRender, 16);
  };

  const cancelScheduledRender = () => {
    if (!pendingRenderFrame) return;
    if (
      pendingRenderFrameScheduler === 'raf' &&
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(pendingRenderFrame);
    } else {
      globalThis.clearTimeout(pendingRenderFrame);
    }
    pendingRenderFrame = 0;
    pendingRenderFrameScheduler = null;
  };

  const filterToys = (query) => {
    if (disposed) return;
    stateController.applyQuery(query);
    computeAndApplyFilters();
    filterPresenter.syncRefineDisclosure();
    scheduleRender();
  };

  const clearSearch = () => {
    stateController.applyQuery('');
    filterPresenter.syncStateToInputs();
    stateController.commitState({ replace: false });
    filterPresenter.syncRefineDisclosure();
    renderCurrentState();
  };

  const resetFiltersAndSearch = () => {
    stateController.clearState();
    emitFilterStateChange();
    filterPresenter.syncStateToInputs();
    stateController.commitState({ replace: false });
    filterPresenter.syncRefineDisclosure();
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
    filterPresenter.syncStateToInputs();
    if (render) {
      renderCurrentState();
    } else {
      computeAndApplyFilters();
    }
  };

  const toggleFilterChip = (chip) => {
    const token = filterPresenter.resolveChipToken(chip);
    if (!token) return;
    const result = stateController.toggleFilter(token);
    if (!result.token) return;
    emitFilterStateChange();
    filterPresenter.syncFilterTokenState(result.token, result.isActive);
    stateController.commitState({ replace: false });
    renderCurrentState();
    filterPresenter.updateFilterResetState();
    filterPresenter.updateActiveFiltersSummary({
      emitFilterStateChange,
      commitAndRender,
    });
  };

  const initCardClickHandlers = () => {
    const list = document.getElementById(targetId);
    if (!list) return null;

    const handleCardClick = (event) => {
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
    };

    list.addEventListener('click', handleCardClick);
    registerCleanup(() => {
      list.removeEventListener('click', handleCardClick);
    });

    if (enableKeyboardHandlers) {
      const handleCardKeydown = (event) => {
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
      };

      list.addEventListener('keydown', handleCardKeydown);
      registerCleanup(() => {
        list.removeEventListener('keydown', handleCardKeydown);
      });
    }

    return null;
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
    updateFilterChipA11y: filterPresenter.updateFilterChipA11y,
    resolveChipToken: filterPresenter.resolveChipToken,
    filterLabelCache: new Map(),
    onSearchInput(query) {
      // Debounce to avoid DOM thrash per keystroke — critical on mobile
      if (this._searchDebounceTimer) {
        clearTimeout(this._searchDebounceTimer);
      }
      this._searchDebounceTimer = setTimeout(() => {
        this._searchDebounceTimer = null;
        filterToys(query);
        stateController.commitState({ replace: true });
      }, 150);
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
      const quickLaunchToy = filterPresenter.resolveQuickLaunchToy(
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

  const init = () => {
    if (initPromise) {
      return initPromise;
    }

    disposed = false;
    const currentToken = ++initToken;

    initPromise = (async () => {
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

      filterPresenter.syncRefineDisclosure();
      threeEffectsManager.setInitialized(true);

      registerCleanup(() => {
        cancelScheduledRender();
        listRenderer.cancelPendingBatch();
      });
      registerCleanup(() => threeEffectsManager.dispose());

      if (enableDarkModeToggle) {
        registerCleanup(setupDarkModeToggle(themeToggleId));
      }

      registerCleanup(inputController.init());
      if (typeof initNavigation === 'function') {
        initNavigation();
      }

      const cardClickCleanup = initCardClickHandlers();
      registerCleanup(cardClickCleanup);

      renderCurrentState();
      threeEffectsManager.requestThreeEffects();

      if (typeof loadFromQuery === 'function') {
        await loadFromQuery();
      }

      if (disposed || currentToken !== initToken) {
        return;
      }

      const handlePopState = () => {
        const nextState = stateController.readStateFromUrl();
        applyState(nextState, { render: true });
        filterPresenter.syncRefineDisclosure();
      };
      window.addEventListener('popstate', handlePopState);
      registerCleanup(() => {
        window.removeEventListener('popstate', handlePopState);
      });

      if (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function'
      ) {
        const narrowViewportQuery = window.matchMedia('(max-width: 680px)');
        const handleViewportChange = () =>
          filterPresenter.syncRefineDisclosure();
        if (typeof narrowViewportQuery.addEventListener === 'function') {
          narrowViewportQuery.addEventListener('change', handleViewportChange);
          registerCleanup(() => {
            narrowViewportQuery.removeEventListener(
              'change',
              handleViewportChange,
            );
          });
        } else if (typeof narrowViewportQuery.addListener === 'function') {
          narrowViewportQuery.addListener(handleViewportChange);
          registerCleanup(() => {
            narrowViewportQuery.removeListener(handleViewportChange);
          });
        }
      }
    })().catch((error) => {
      if (currentToken === initToken) {
        runCleanupStack();
        initPromise = null;
      }
      throw error;
    });

    return initPromise;
  };

  return {
    init,
    setToys,
    renderToys: renderCurrentState,
    filterToys,
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      initToken += 1;
      initPromise = null;
      cancelScheduledRender();
      runCleanupStack();
    },
  };
}
