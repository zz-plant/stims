import { createLibraryDomCache } from './library-view/dom-cache.js';
import {
  createFilterToken,
  createLibraryStateStorage,
  getStateFromUrl,
  normalizeCapabilityToken,
  normalizeFilterToken,
  normalizeMoodToken,
  resolvePathname,
  stateToParams,
} from './library-view/filter-state.js';
import { ensureIconSymbol, SVG_NS } from './library-view/icon-sprite.js';
import { setupDarkModeToggle } from './library-view/theme-toggle.js';
import { createLibraryThreeEffects } from './library-view/three-library-effects.ts';
import { getRecentToySlugs } from './utils/growth-metrics.ts';

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
  const { saveStateToStorage, readStateFromStorage } =
    createLibraryStateStorage({ storageKey: STORAGE_KEY });
  const COMPATIBILITY_MODE_KEY = 'stims-compatibility-mode';
  let allToys = toys;
  let originalOrder = new Map();
  let searchQuery = '';
  let sortBy = 'featured';
  let lastCommittedQuery = '';
  let pendingCommit;
  let pendingRenderFrame = 0;
  let lastFilteredToys = [];
  let lastRenderedQuery = '';
  let suggestionSignature = '';
  let renderedCardMap = new Map();
  let toyBySlug = new Map();
  let toySearchMetadata = new Map();
  const filterLabelCache = new Map();
  const activeFilters = new Set();
  const threeEffects = createLibraryThreeEffects();
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

  const getToyList = () => document.getElementById(targetId);
  const getToyKey = (toy, index = 0) => toy?.slug ?? `toy-${index}`;

  const buildToySearchMetadata = (toy) => {
    const tags = (toy.tags ?? []).map((tag) => tag.toLowerCase());
    const moods = (toy.moods ?? []).map((mood) => mood.toLowerCase());
    const flags = [
      toy.requiresWebGPU ? 'webgpu webgl gpu' : '',
      toy.capabilities?.microphone ? 'microphone mic live audio' : '',
      toy.capabilities?.demoAudio ? 'demo audio preview starter' : '',
      toy.capabilities?.motion ? 'motion tilt gyro mobile' : '',
    ]
      .filter(Boolean)
      .map((value) => value.toLowerCase());

    const fields = {
      title: toy.title?.toLowerCase() ?? '',
      slug: toy.slug?.toLowerCase() ?? '',
      description: toy.description?.toLowerCase() ?? '',
      tags,
      moods,
      flags,
    };

    return {
      fields,
      searchHaystacks: [
        fields.title,
        fields.slug,
        fields.description,
        ...tags,
        ...moods,
        ...flags,
      ].filter(Boolean),
    };
  };

  const syncRefineDisclosure = () => {
    const refine = ensureLibraryRefine();
    if (!(refine instanceof HTMLElement) || refine.tagName !== 'DETAILS')
      return;
    const summary = refine.querySelector('summary');

    const hasActiveRefinement =
      searchQuery.trim().length > 0 ||
      activeFilters.size > 0 ||
      sortBy !== 'featured';

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
      window.matchMedia('(max-width: 680px)').matches;

    refine.open = !shouldCollapseByViewport;

    if (summary instanceof HTMLElement) {
      summary.textContent = refine.open ? 'Hide filters' : 'More filters';
    }
  };

  const getOriginalIndex = (toy) => originalOrder.get(getToyKey(toy)) ?? 0;
  const getFeaturedRank = (toy) =>
    Number.isFinite(toy.featuredRank)
      ? toy.featuredRank
      : Number.POSITIVE_INFINITY;

  const getSortLabel = () => {
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
    return sortLabels[sortBy] ?? sortBy;
  };

  const matchesMoodToken = (toyMoods, value) => {
    const normalizedValue = normalizeMoodToken(value);
    const aliases = {
      calm: ['calming', 'serene', 'minimal'],
      calming: ['calm', 'serene', 'minimal'],
    };
    const accepted = new Set([
      normalizedValue,
      ...(aliases[normalizedValue] ?? []),
    ]);
    return (toyMoods ?? []).some((mood) => accepted.has(mood.toLowerCase()));
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

    const baseActiveLabels = Array.from(activeFilters)
      .filter(
        (token) =>
          token.startsWith('mood:') || token === 'capability:microphone',
      )
      .map((token) => formatTokenLabel(token))
      .slice(0, 2);

    if (baseActiveLabels.length === 0) {
      note.textContent =
        'Quick filters: demo audio, microphone, mobile-friendly, and motion.';
      return;
    }

    note.textContent = `Quick filters active: ${baseActiveLabels.join(' + ')}`;
  };

  const updateActiveFiltersSummary = () => {
    const summary = ensureActiveFiltersSummary();
    if (!(summary instanceof HTMLElement)) {
      return;
    }

    const tokens = Array.from(activeFilters);
    const hasQuery = searchQuery.trim().length > 0;
    const hasTokens = tokens.length > 0;
    const hasSort = sortBy !== 'featured';
    const canClear = hasTokens || hasSort || hasQuery;
    const chipItems = [
      ...(hasQuery
        ? [
            {
              label: `Search: ${searchQuery.trim()}`,
              onClick: () => clearSearch(),
            },
          ]
        : []),
      ...tokens.map((token) => ({
        label: formatTokenLabel(token),
        onClick: () => {
          activeFilters.delete(token);
          syncFilterTokenState(token, false);
          emitFilterStateChange();
          commitState({ replace: false });
          renderToys(applyFilters());
          updateFilterResetState();
          updateActiveFiltersSummary();
        },
      })),
      ...(hasSort
        ? [
            {
              label: `Sort: ${getSortLabel()}`,
              onClick: () => {
                sortBy = 'featured';
                const sortControl = ensureSortControl();
                if (
                  sortControl instanceof HTMLElement &&
                  sortControl.tagName === 'SELECT'
                ) {
                  sortControl.value = sortBy;
                }
                commitState({ replace: false });
                renderToys(applyFilters());
                updateFilterResetState();
                updateActiveFiltersSummary();
              },
            },
          ]
        : []),
    ];

    const summaryTextParts = [];
    if (hasQuery) {
      summaryTextParts.push(`Search: ${searchQuery.trim()}`);
    }
    if (tokens.length > 0) {
      summaryTextParts.push(
        `Filters: ${tokens.map((token) => formatTokenLabel(token)).join(', ')}`,
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
      status.textContent = summaryTextParts.join(' • ') || 'Showing all toys';
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
    if (
      clearButton instanceof HTMLElement &&
      clearButton.tagName === 'BUTTON'
    ) {
      clearButton.disabled = !canClear;
      clearButton.setAttribute('aria-disabled', String(!canClear));
    }

    updateSearchMetaNote();
  };

  const updateSearchClearState = () => {
    const clearButton = ensureSearchClearButton();
    if (!(clearButton instanceof HTMLElement)) return;
    if (clearButton.tagName !== 'BUTTON') return;
    const hasQuery = searchQuery.trim().length > 0;
    clearButton.disabled = !hasQuery;
    clearButton.setAttribute('aria-disabled', String(!hasQuery));
  };

  const updateFilterResetState = () => {
    const resetButton = ensureFilterResetButton();
    if (!(resetButton instanceof HTMLElement)) return;
    if (resetButton.tagName !== 'BUTTON') return;
    const hasRefinements =
      activeFilters.size > 0 ||
      sortBy !== 'featured' ||
      searchQuery.trim().length > 0;
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

  const emitFilterStateChange = () => {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new Event('library:filters-changed'));
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

    const parts = [`${visibleCount} results`];

    if (activeFilters.size > 0) {
      parts.push(
        `${activeFilters.size} filter${activeFilters.size === 1 ? '' : 's'}`,
      );
    }

    if (sortBy !== 'featured') {
      parts.push(getSortLabel());
    }

    const quickLaunchToy = resolveQuickLaunchToy(lastFilteredToys, '');
    if (quickLaunchToy) {
      parts.push(`↵ ${quickLaunchToy.title}`);
    }

    meta.textContent = parts.join(' • ');
  };

  const resetFiltersAndSearch = () => {
    searchQuery = '';
    Array.from(activeFilters).forEach((token) => {
      syncFilterTokenState(token, false);
    });
    activeFilters.clear();
    sortBy = 'featured';
    emitFilterStateChange();

    if (searchInputId) {
      const search = document.getElementById(searchInputId);
      if (search && 'value' in search) {
        search.value = '';
      }
    }

    const sortControl = ensureSortControl();
    if (sortControl && sortControl.tagName === 'SELECT') {
      sortControl.value = sortBy;
    }

    commitState({ replace: false });
    syncRefineDisclosure();
    renderToys(applyFilters());
    updateSearchClearState();
    updateFilterResetState();
  };

  const capabilityScore = (toy) =>
    (toy.requiresWebGPU ? 2 : 0) +
    Number(toy.capabilities?.microphone) +
    Number(toy.capabilities?.demoAudio) +
    Number(toy.capabilities?.motion);

  const lowSetupScore = (toy) => {
    const hasMic = Boolean(toy.capabilities?.microphone);
    const hasDemo = Boolean(toy.capabilities?.demoAudio);
    const requiresWebGPU = Boolean(toy.requiresWebGPU);
    const hasMotion = Boolean(toy.capabilities?.motion);

    return (
      Number(hasDemo) * 3 +
      Number(!hasMic) * 2 +
      Number(!requiresWebGPU) * 2 +
      Number(!hasMotion)
    );
  };

  const hasSetupIntentToken = (query) => {
    const setupTokens = new Set([
      'mic',
      'microphone',
      'demo',
      'audio',
      'motion',
      'tilt',
      'gyro',
      'webgpu',
      'webgl',
    ]);
    return getQueryTokens(query).some((token) => setupTokens.has(token));
  };

  const shouldApplyLowSetupBoost = () => {
    if (sortBy !== 'featured') return false;
    if (activeFilters.size > 0) return false;
    if (!searchQuery.trim()) return false;
    if (hasSetupIntentToken(searchQuery)) return false;
    return true;
  };

  const sortList = (list) => {
    const sorted = [...list];
    switch (sortBy) {
      case 'newest':
        return sorted.sort((a, b) => getOriginalIndex(b) - getOriginalIndex(a));
      case 'az':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'immersive':
        return sorted.sort(
          (a, b) =>
            capabilityScore(b) - capabilityScore(a) ||
            getOriginalIndex(a) - getOriginalIndex(b),
        );
      default:
        if (shouldApplyLowSetupBoost()) {
          return sorted.sort(
            (a, b) =>
              lowSetupScore(b) - lowSetupScore(a) ||
              getFeaturedRank(a) - getFeaturedRank(b) ||
              getOriginalIndex(a) - getOriginalIndex(b),
          );
        }
        return sorted.sort(
          (a, b) =>
            getFeaturedRank(a) - getFeaturedRank(b) ||
            getOriginalIndex(a) - getOriginalIndex(b),
        );
    }
  };

  const matchesFilter = (toy, token) => {
    const [type, value] = token.split(':');
    if (!type || !value) return true;

    switch (type) {
      case 'mood':
        return matchesMoodToken(toy.moods, value);
      case 'capability':
        return Boolean(toy.capabilities?.[normalizeCapabilityToken(value)]);
      case 'feature':
        if (value === 'webgpu') return Boolean(toy.requiresWebGPU);
        if (value === 'compatible') {
          return !toy.requiresWebGPU || Boolean(toy.allowWebGLFallback);
        }
        return true;
      case 'tag':
        return (toy.tags ?? []).some((tag) => tag.toLowerCase() === value);
      default:
        return true;
    }
  };

  const getQueryTokens = (query) =>
    query
      .trim()
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);

  const getMatchedFields = (toy, queryTokens) => {
    if (!queryTokens.length) return [];

    const metadata = toySearchMetadata.get(getToyKey(toy));
    const fields = metadata?.fields;
    if (!fields) return [];

    const matchedSources = new Set();
    queryTokens.forEach((token) => {
      if (fields.title.includes(token)) matchedSources.add('Title');
      if (fields.slug.includes(token)) matchedSources.add('Slug');
      if (fields.description.includes(token)) {
        matchedSources.add('Description');
      }
      if (fields.tags.some((tag) => tag.includes(token))) {
        matchedSources.add('Tags');
      }
      if (fields.moods.some((mood) => mood.includes(token))) {
        matchedSources.add('Moods');
      }
      if (toy.requiresWebGPU && 'webgpu'.includes(token)) {
        matchedSources.add('WebGPU');
      }
      if (toy.capabilities?.microphone && 'microphone mic'.includes(token)) {
        matchedSources.add('Mic');
      }
      if (toy.capabilities?.demoAudio && 'demo audio'.includes(token)) {
        matchedSources.add('Demo audio');
      }
      if (toy.capabilities?.motion && 'motion tilt gyro'.includes(token)) {
        matchedSources.add('Motion');
      }
    });

    return Array.from(matchedSources).slice(0, 3);
  };

  const matchesSearchQuery = (toy, queryTokens) => {
    if (queryTokens.length === 0) return true;
    const metadata = toySearchMetadata.get(getToyKey(toy));
    const searchHaystacks = metadata?.searchHaystacks ?? [];

    return queryTokens.every((token) =>
      searchHaystacks.some((field) => field.includes(token)),
    );
  };

  const computeFilteredToys = () => {
    const queryTokens = getQueryTokens(searchQuery);
    const filterTokens = Array.from(activeFilters);
    const filtered = allToys.filter((toy) => {
      const matchesChips =
        filterTokens.length === 0 ||
        filterTokens.every((token) => matchesFilter(toy, token));
      return matchesChips && matchesSearchQuery(toy, queryTokens);
    });

    return sortList(filtered);
  };

  const applyFilters = () => {
    const sorted = computeFilteredToys();
    lastFilteredToys = sorted;
    updateResultsMeta(sorted.length);
    return sorted;
  };

  const setToys = (nextToys = []) => {
    allToys = nextToys;
    originalOrder = new Map(
      nextToys.map((toy, index) => [getToyKey(toy, index), index]),
    );
    toyBySlug = new Map(
      nextToys.filter((toy) => toy.slug).map((toy) => [toy.slug, toy]),
    );
    toySearchMetadata = new Map(
      nextToys.map((toy, index) => [
        getToyKey(toy, index),
        buildToySearchMetadata(toy),
      ]),
    );
    populateSearchSuggestions();
  };

  const commitState = ({ replace }) => {
    const state = {
      query: searchQuery,
      filters: Array.from(activeFilters),
      sort: sortBy,
    };
    const params = stateToParams(state);
    const nextUrl = `${resolvePathname()}${
      params.toString() ? `?${params.toString()}` : ''
    }`;
    try {
      if (replace) {
        window.history.replaceState(state, '', nextUrl);
      } else {
        window.history.pushState(state, '', nextUrl);
      }
    } catch (_error) {
      // Ignore history errors in non-browser environments.
    }
    saveStateToStorage(state);
  };

  const applyState = (state, { render = true } = {}) => {
    searchQuery = typeof state.query === 'string' ? state.query : '';
    sortBy = state.sort ?? 'featured';
    activeFilters.clear();
    (state.filters ?? [])
      .map((token) => normalizeFilterToken(token))
      .filter(Boolean)
      .forEach((token) => activeFilters.add(token));
    lastCommittedQuery = searchQuery.trim();

    if (searchInputId) {
      const search = document.getElementById(searchInputId);
      if (search && 'value' in search) {
        search.value = searchQuery;
      }
    }

    const chips = ensureFilterChips();
    chips.forEach((chip) => {
      const type = chip.getAttribute('data-filter-type');
      const value = chip.getAttribute('data-filter-value');
      if (!type || !value) return;
      const token = createFilterToken(type, value);
      if (!token) return;
      const isActive = activeFilters.has(token);
      chip.classList.toggle('is-active', isActive);
      updateFilterChipA11y(chip, isActive);
    });
    emitFilterStateChange();

    const sortControl = ensureSortControl();
    if (sortControl && sortControl.tagName === 'SELECT') {
      sortControl.value = sortBy;
    }

    if (render) {
      renderToys(applyFilters());
    }
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

  const titleCaseLabel = (value = '') =>
    value
      .replace(/\s*·\s*/g, ' ')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\w/, (char) => char.toUpperCase());

  const normalizeGuideKey = (value = '') =>
    value
      .toLowerCase()
      .replace(/\s*·\s*/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const guidesOverlap = (left, right) => {
    const normalizedLeft = normalizeGuideKey(left);
    const normalizedRight = normalizeGuideKey(right);
    if (!normalizedLeft || !normalizedRight) return false;
    return (
      normalizedLeft === normalizedRight ||
      normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft)
    );
  };

  const getInteractionSignal = (toy) => {
    if (toy.capabilities?.motion) return 'Tilt';
    const tags = (toy.tags ?? []).map((tag) => tag.toLowerCase());
    if (
      tags.some((tag) =>
        ['touch', 'gestural', 'sculpting', 'pottery', 'haptics'].includes(tag),
      )
    ) {
      return 'Touch-led';
    }
    return null;
  };

  const getCardSignals = (toy) => {
    const signals = [];
    const interactionSignal = getInteractionSignal(toy);
    if (interactionSignal) {
      signals.push(interactionSignal);
    }

    (toy.moods ?? []).slice(0, 2).forEach((mood) => {
      const label = titleCaseLabel(mood);
      if (!signals.includes(label)) {
        signals.push(label);
      }
    });

    return signals.slice(0, 3);
  };

  const getPrimaryGuideLabel = (toy) => {
    if (toy.starterPreset?.label) {
      return titleCaseLabel(toy.starterPreset.label);
    }
    if (toy.capabilities?.motion) {
      return 'Tilt your device';
    }
    if (getInteractionSignal(toy) === 'Touch-led') {
      return 'Use touch';
    }
    if (toy.wowControl) {
      return titleCaseLabel(toy.wowControl);
    }
    if (toy.controls?.[0]) {
      return titleCaseLabel(toy.controls[0]);
    }
    if (toy.recommendedCapability === 'microphone') {
      return 'Use live mic';
    }
    if (toy.recommendedCapability === 'demoAudio') {
      return 'Use demo audio';
    }
    return null;
  };

  const getSecondaryGuideLabel = (toy, primaryGuide) => {
    if (toy.wowControl) {
      const wowLabel = titleCaseLabel(toy.wowControl);
      const usesPresetLanguage = /preset|starter/i.test(wowLabel);
      if (!guidesOverlap(primaryGuide, wowLabel) && !usesPresetLanguage) {
        return wowLabel;
      }
    }

    if (
      toy.recommendedCapability === 'microphone' &&
      !guidesOverlap(primaryGuide, 'Use live mic')
    ) {
      return 'Use live mic';
    }

    if (
      toy.recommendedCapability === 'demoAudio' &&
      !guidesOverlap(primaryGuide, 'Use demo audio')
    ) {
      return 'Use demo audio';
    }

    return null;
  };

  const getCardGuidance = (toy) => {
    const primaryGuide = getPrimaryGuideLabel(toy);
    const secondaryGuide = getSecondaryGuideLabel(toy, primaryGuide);
    const guides = [primaryGuide, secondaryGuide].filter(Boolean);

    if (guides.length > 0) {
      return `Try first: ${guides.join(' • ')}`;
    }

    if (toy.firstRunHint) {
      return toy.firstRunHint;
    }

    return null;
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
      heading.textContent = 'Continue where you left off';
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

  const createCard = (toy, queryTokens = []) => {
    const card = document.createElement(cardElement);
    card.className = 'webtoy-card';
    if (toy.slug) {
      card.dataset.toySlug = toy.slug;
    }
    if (toy.type) {
      card.dataset.toyType = toy.type;
    }
    if (toy.module) {
      card.dataset.toyModule = toy.module;
    }
    const href =
      toy.type === 'module'
        ? `toy.html?toy=${encodeURIComponent(toy.slug)}`
        : toy.module;
    if (cardElement === 'button') {
      card.type = 'button';
    } else if (cardElement === 'a') {
      card.href = href;
      card.setAttribute('data-toy-href', href);
    }

    if (enableIcons) {
      const symbolId = ensureIconSymbol(toy);
      if (symbolId) {
        const icon = document.createElementNS(SVG_NS, 'svg');
        icon.classList.add('toy-icon');
        icon.setAttribute('viewBox', '0 0 120 120');
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', `${toy.title} icon`);

        const title = document.createElementNS(SVG_NS, 'title');
        title.textContent = `${toy.title} icon`;
        icon.appendChild(title);

        const use = document.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', `#${symbolId}`);
        icon.appendChild(use);
        card.appendChild(icon);
      }
    }

    const title = document.createElement('h3');
    title.textContent = toy.title;
    const desc = document.createElement('p');
    desc.className = 'webtoy-card-description';
    desc.textContent = toy.description;
    card.appendChild(title);
    card.appendChild(desc);

    const guidance = getCardGuidance(toy);
    if (guidance) {
      const guidanceNode = document.createElement('p');
      guidanceNode.className = 'webtoy-card-guidance';
      guidanceNode.textContent = guidance;
      card.appendChild(guidanceNode);
    }

    const matchedFields = getMatchedFields(toy, queryTokens);
    if (matchedFields.length > 0) {
      const matches = document.createElement('p');
      matches.className = 'webtoy-card-match';

      const label = document.createElement('strong');
      label.textContent = 'Matched in';
      matches.appendChild(label);

      matchedFields.forEach((field) => {
        const matchToken = document.createElement('mark');
        matchToken.textContent = field;
        matches.appendChild(matchToken);
      });

      card.appendChild(matches);
    }

    if (enableCapabilityBadges) {
      const signals = getCardSignals(toy);
      if (signals.length > 0) {
        const metaRow = document.createElement('div');
        metaRow.className = 'webtoy-card-signals';
        signals.forEach((signal) => {
          const badge = document.createElement('span');
          badge.className = 'webtoy-card-signal';
          badge.textContent = signal;
          metaRow.appendChild(badge);
        });
        card.appendChild(metaRow);
      }
    }

    if (toy.type === 'module') {
      const actions = document.createElement('div');
      actions.className = 'webtoy-card-actions';

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'cta-button cta-button--accent';
      open.textContent = 'Open';
      open.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const launchCard = event.currentTarget.closest('.webtoy-card');
        void openToy(toy, { launchCard });
      });
      open.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.stopPropagation();
        }
      });
      actions.appendChild(open);

      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'cta-button cta-button--muted';
      play.textContent = toy.capabilities?.demoAudio
        ? 'Preview'
        : toy.capabilities?.microphone
          ? 'Use mic'
          : 'Open';
      play.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const launchCard = event.currentTarget.closest('.webtoy-card');
        void openToy(toy, {
          preferDemoAudio: Boolean(toy.capabilities?.demoAudio),
          launchCard,
        });
      });
      play.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.stopPropagation();
        }
      });

      actions.appendChild(play);

      card.appendChild(actions);
    }

    return card;
  };

  const applyCardMotionVariant = (card, index) => {
    if (!(card instanceof HTMLElement)) return;
    const variants = [
      'card-motion--rise',
      'card-motion--tilt',
      'card-motion--glide',
      'card-motion--bloom',
    ];
    card.classList.remove(...variants);
    card.classList.add(variants[index % variants.length]);
    card.style.setProperty('--card-enter-delay', `${index * 45}ms`);
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

  const createEmptyState = () => {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.setAttribute('role', 'status');
    emptyState.setAttribute('aria-live', 'polite');

    const message = document.createElement('p');
    message.className = 'empty-state__message';
    message.textContent =
      'No stims match your search or filters. Try clearing your search or removing filters.';

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'cta-button';
    resetButton.textContent = 'Reset view';
    resetButton.addEventListener('click', () => resetFiltersAndSearch());

    const quickActions = document.createElement('div');
    quickActions.className = 'webtoy-card-actions';

    const applySuggestedSearch = (query) => {
      searchQuery = query;
      if (searchInputId) {
        const search = document.getElementById(searchInputId);
        if (search && 'value' in search) {
          search.value = query;
        }
      }
      commitState({ replace: false });
      renderToys(applyFilters());
      updateSearchClearState();
      updateActiveFiltersSummary();
    };

    [
      { label: 'Try demo audio', query: 'demo audio' },
      { label: 'Try mobile', query: 'mobile' },
      { label: 'Try webgpu', query: 'webgpu' },
    ].forEach(({ label, query }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cta-button cta-button--muted';
      button.textContent = label;
      button.addEventListener('click', () => applySuggestedSearch(query));
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

  const scheduleRender = () => {
    if (pendingRenderFrame) return;

    const commitRender = () => {
      pendingRenderFrame = 0;
      renderToys(applyFilters());
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

  const renderToys = (listToRender) => {
    const list = getToyList();
    if (!list) return;
    const shouldRebuildCards = lastRenderedQuery !== searchQuery;
    if (shouldRebuildCards) {
      renderedCardMap = new Map();
    }

    const fragment = document.createDocumentFragment();
    if (listToRender.length === 0) {
      renderedCardMap.clear();
      fragment.appendChild(createEmptyState());
      list.replaceChildren(fragment);
      updateResultsMeta(0);
      updateActiveFiltersSummary();
      return;
    }

    renderGrowthPanels(fragment);
    const nextCardMap = new Map();
    const cards = [];
    const queryTokens = getQueryTokens(searchQuery);
    listToRender.forEach((toy, index) => {
      const key = getToyKey(toy, index);
      const card = renderedCardMap.get(key) ?? createCard(toy, queryTokens);
      applyCardMotionVariant(card, index);
      nextCardMap.set(key, card);
      cards.push(card);
      fragment.appendChild(card);
    });

    renderedCardMap = nextCardMap;
    lastRenderedQuery = searchQuery;
    list.replaceChildren(fragment);

    threeEffects.syncCardPreviews(cards, listToRender);
    updateResultsMeta(listToRender.length);
    updateActiveFiltersSummary();
  };

  const filterToys = (query) => {
    searchQuery = query;
    lastFilteredToys = computeFilteredToys();
    syncRefineDisclosure();
    scheduleRender();
  };

  const clearSearch = () => {
    searchQuery = '';
    if (searchInputId) {
      const search = document.getElementById(searchInputId);
      if (search && 'value' in search) {
        search.value = '';
      }
    }
    commitState({ replace: false });
    syncRefineDisclosure();
    renderToys(applyFilters());
    updateSearchClearState();
    updateActiveFiltersSummary();
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

  const toggleFilterChip = (chip) => {
    const token = resolveChipToken(chip);
    if (!token) return;
    const isActive = !activeFilters.has(token);
    emitFilterStateChange();
    if (isActive) {
      activeFilters.add(token);
    } else {
      activeFilters.delete(token);
    }
    syncFilterTokenState(token, isActive);
    commitState({ replace: false });
    renderToys(applyFilters());
    updateFilterResetState();
    updateActiveFiltersSummary();
  };

  const initFilters = () => {
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
      toggleFilterChip(chip);
    };

    document[FILTER_DELEGATE_KEY] = handleFilterChipClick;
    document.addEventListener('click', handleFilterChipClick);

    const sortControl = ensureSortControl();
    if (sortControl && sortControl.tagName === 'SELECT') {
      sortControl.addEventListener('change', () => {
        sortBy = sortControl.value;
        commitState({ replace: false });
        renderToys(applyFilters());
      });
    }

    const resetButton = ensureFilterResetButton();
    if (
      resetButton instanceof HTMLElement &&
      resetButton.tagName === 'BUTTON'
    ) {
      resetButton.addEventListener('click', () => resetFiltersAndSearch());
      updateFilterResetState();
    }

    const refine = ensureLibraryRefine();
    if (refine instanceof HTMLElement && refine.tagName === 'DETAILS') {
      refine.addEventListener('toggle', () => {
        const summary = refine.querySelector('summary');
        if (!(summary instanceof HTMLElement)) return;
        summary.textContent = refine.open ? 'Hide filters' : 'More filters';
      });
    }

    const clearButton = ensureActiveFiltersClear();
    if (
      clearButton instanceof HTMLElement &&
      clearButton.tagName === 'BUTTON' &&
      clearButton !== resetButton
    ) {
      clearButton.addEventListener('click', () => resetFiltersAndSearch());
    }
  };

  const initSearch = () => {
    if (!searchInputId) return;
    const search = document.getElementById(searchInputId);
    if (search) {
      search.addEventListener('input', (e) => {
        filterToys(e.target.value);
        commitState({ replace: true });
        if (pendingCommit) {
          window.clearTimeout(pendingCommit);
        }
        pendingCommit = window.setTimeout(() => {
          if (searchQuery.trim() !== lastCommittedQuery) {
            lastCommittedQuery = searchQuery.trim();
            commitState({ replace: false });
          }
        }, 500);
      });

      search.addEventListener('blur', () => {
        if (searchQuery.trim() !== lastCommittedQuery) {
          lastCommittedQuery = searchQuery.trim();
          commitState({ replace: false });
        }
      });
    }

    const form = ensureSearchForm();
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
      });
    }

    const clearButton = ensureSearchClearButton();
    if (
      clearButton instanceof HTMLElement &&
      clearButton.tagName === 'BUTTON'
    ) {
      clearButton.addEventListener('click', () => clearSearch());
      updateSearchClearState();
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
    };

    search?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (searchQuery.trim().length > 0) {
          event.preventDefault();
          clearSearch();
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

      const quickLaunchToy = resolveQuickLaunchToy(
        lastFilteredToys,
        searchQuery,
      );
      if (!quickLaunchToy) return;

      event.preventDefault();
      void openToy(quickLaunchToy);
    });

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
        if (searchQuery.trim().length > 0 || activeFilters.size > 0) {
          event.preventDefault();
          clearAllFilters();
        }
      }
    });
  };

  const init = async () => {
    setToys(allToys);
    const urlState = getStateFromUrl();
    const hasUrlState =
      urlState.query.trim().length > 0 ||
      urlState.filters.length > 0 ||
      urlState.sort !== 'featured';
    if (hasUrlState) {
      applyState(urlState, { render: false });
    } else {
      const storedState = readStateFromStorage();
      if (storedState) {
        applyState(
          {
            query: storedState.query ?? '',
            filters: storedState.filters ?? [],
            sort: storedState.sort ?? 'featured',
          },
          { render: false },
        );
        commitState({ replace: true });
      } else {
        try {
          if (
            window.sessionStorage.getItem(COMPATIBILITY_MODE_KEY) === 'true'
          ) {
            applyState(
              {
                query: '',
                filters: ['feature:compatible'],
                sort: 'featured',
              },
              { render: false },
            );
            commitState({ replace: true });
          }
        } catch (_error) {
          // Ignore storage access issues.
        }
      }
    }

    syncRefineDisclosure();
    threeEffects.init();
    renderToys(applyFilters());

    if (enableDarkModeToggle) {
      setupDarkModeToggle(themeToggleId);
    }

    initSearch();
    initFilters();
    if (typeof initNavigation === 'function') {
      initNavigation();
    }
    initCardClickHandlers();
    if (typeof loadFromQuery === 'function') {
      await loadFromQuery();
    }

    window.addEventListener('popstate', () => {
      const nextState = getStateFromUrl();
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
    renderToys,
    filterToys,
  };
}
