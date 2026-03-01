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
  let lastFilteredToys = [];
  const activeFilters = new Set();
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
  } = createLibraryDomCache(document);

  const syncRefineDisclosure = () => {
    const refine = ensureLibraryRefine();
    if (!(refine instanceof HTMLElement) || refine.tagName !== 'DETAILS')
      return;

    const hasActiveRefinement =
      searchQuery.trim().length > 0 ||
      activeFilters.size > 0 ||
      sortBy !== 'featured';

    if (hasActiveRefinement) {
      refine.open = true;
      return;
    }

    const shouldCollapseByViewport =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 680px)').matches;

    refine.open = !shouldCollapseByViewport;
  };

  const getOriginalIndex = (toy) => originalOrder.get(toy.slug) ?? 0;
  const getFeaturedRank = (toy) =>
    Number.isFinite(toy.featuredRank)
      ? toy.featuredRank
      : Number.POSITIVE_INFINITY;

  const getSortLabel = () => {
    const sortControl = document.querySelector('[data-sort-control]');
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
    const [type, value = ''] = token.split(':');
    if (!type) return token;
    const normalizedValue = value.toLowerCase();
    const chipMatch = Array.from(
      document.querySelectorAll('[data-filter-chip]'),
    ).find((chip) => {
      const chipType = chip.getAttribute('data-filter-type');
      const chipValue = chip.getAttribute('data-filter-value');
      return chipType === type && chipValue?.toLowerCase() === normalizedValue;
    });
    const chipLabel = chipMatch?.textContent?.trim();
    if (chipLabel) return chipLabel;
    const fallbackLabel = normalizedValue.replace(/[-_]/g, ' ');
    return fallbackLabel
      ? `${fallbackLabel[0].toUpperCase()}${fallbackLabel.slice(1)}`
      : token;
  };

  const updateSearchMetaNote = () => {
    const note = ensureSearchMetaNote();
    if (!(note instanceof HTMLElement)) return;

    const activeLabels = Array.from(activeFilters)
      .map((token) => formatTokenLabel(token))
      .slice(0, 2);

    if (activeLabels.length === 0) {
      note.textContent = 'Choose a mood or audio option to narrow results.';
      return;
    }

    note.textContent = `Matched: ${activeLabels.join(' + ')}`;
  };

  const updateActiveFiltersSummary = () => {
    const summary = ensureActiveFiltersSummary();
    const chipsContainer = ensureActiveFiltersChips();
    if (
      !(summary instanceof HTMLElement) ||
      !(chipsContainer instanceof HTMLElement)
    ) {
      return;
    }

    const tokens = Array.from(activeFilters);
    const hasTokens = tokens.length > 0;
    summary.hidden = false;
    summary.setAttribute('aria-hidden', 'false');
    summary.classList.toggle('is-empty', !hasTokens);
    chipsContainer.innerHTML = '';

    const appendChip = ({ label, onClick, ariaLabel }) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'active-filter-chip';
      chip.textContent = label;
      if (ariaLabel) {
        chip.setAttribute('aria-label', ariaLabel);
      }
      chip.addEventListener('click', onClick);
      chipsContainer.appendChild(chip);
    };

    tokens.forEach((token) => {
      const label = formatTokenLabel(token);
      appendChip({
        label,
        ariaLabel: `Remove filter ${label}`,
        onClick: () => removeFilterToken(token),
      });
    });

    const status = ensureActiveFiltersStatus();
    if (status instanceof HTMLElement) {
      status.textContent = hasTokens
        ? `${tokens.length} active`
        : 'No filters selected';
    }

    const clearButton = ensureActiveFiltersClear();
    if (
      clearButton instanceof HTMLElement &&
      clearButton.tagName === 'BUTTON'
    ) {
      clearButton.disabled = !hasTokens;
      clearButton.setAttribute('aria-disabled', String(!hasTokens));
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
    const hasFilters = activeFilters.size > 0;
    resetButton.disabled = !hasFilters;
    resetButton.setAttribute('aria-disabled', String(!hasFilters));
  };

  const updateFilterChipA11y = (chip, isActive) => {
    if (!chip || typeof chip.setAttribute !== 'function') return;
    chip.setAttribute('aria-pressed', String(isActive));
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
    activeFilters.clear();
    sortBy = 'featured';

    const chips = document.querySelectorAll('[data-filter-chip].is-active');
    chips.forEach((chip) => {
      chip.classList.remove('is-active');
      updateFilterChipA11y(chip, false);
    });
    emitFilterStateChange();

    if (searchInputId) {
      const search = document.getElementById(searchInputId);
      if (search && 'value' in search) {
        search.value = '';
      }
    }

    const sortControl = document.querySelector('[data-sort-control]');
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

    const matchedSources = new Set();
    queryTokens.forEach((token) => {
      if (toy.title?.toLowerCase().includes(token)) matchedSources.add('Title');
      if (toy.slug?.toLowerCase().includes(token)) matchedSources.add('Slug');
      if (toy.description?.toLowerCase().includes(token)) {
        matchedSources.add('Description');
      }
      if ((toy.tags ?? []).some((tag) => tag.toLowerCase().includes(token))) {
        matchedSources.add('Tags');
      }
      if (
        (toy.moods ?? []).some((mood) => mood.toLowerCase().includes(token))
      ) {
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

  const applyFilters = () => {
    const filtered = allToys.filter((toy) => {
      const matchesChips =
        activeFilters.size === 0 ||
        Array.from(activeFilters).every((token) => matchesFilter(toy, token));
      return matchesChips;
    });

    const sorted = sortList(filtered);
    lastFilteredToys = sorted;
    updateResultsMeta(sorted.length);
    return sorted;
  };

  const setToys = (nextToys = []) => {
    allToys = nextToys;
    originalOrder = new Map(
      nextToys.map((toy, index) => [toy.slug ?? `toy-${index}`, index]),
    );
    populateSearchSuggestions();
  };

  const commitState = ({ replace }) => {
    const state = {
      query: '',
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
    searchQuery = '';
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

    const chips = document.querySelectorAll('[data-filter-chip]');
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

    const sortControl = document.querySelector('[data-sort-control]');
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

  const openToy = (toy, { preferDemoAudio = false } = {}) => {
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

    openToy(toy);
  };

  const getBestForLabel = (toy) => {
    if (toy.capabilities?.motion) return 'Best for mobile tilt';
    if (toy.capabilities?.demoAudio && toy.capabilities?.microphone) {
      return 'Best for quick starts or live rooms';
    }
    if (toy.capabilities?.demoAudio) return 'Best for no-permission preview';
    if (toy.capabilities?.microphone) return 'Best for live room audio';
    return 'Best for visual exploration';
  };

  const renderGrowthPanels = (listElement) => {
    if (!(listElement instanceof HTMLElement)) return;

    const recentSlugs = getRecentToySlugs(3);
    const recentToys = recentSlugs
      .map((slug) => allToys.find((toy) => toy.slug === slug))
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
        button.addEventListener('click', () => openToy(toy));
        list.appendChild(button);
      });
      panel.appendChild(list);
      listElement.appendChild(panel);
    }
  };

  const createCard = (toy) => {
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

    const bestFor = document.createElement('p');
    bestFor.className = 'webtoy-card-bestfor';
    bestFor.textContent = getBestForLabel(toy);
    card.appendChild(bestFor);

    const matchedFields = getMatchedFields(toy, getQueryTokens(searchQuery));
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
      const metaRow = document.createElement('div');
      metaRow.className = 'webtoy-card-meta';

      const createBadge = ({
        label,
        title,
        ariaLabel,
        warning = false,
        role = null,
        tone = null,
      }) => {
        const badge = document.createElement('span');
        badge.className = 'capability-badge';
        badge.textContent = label;
        if (title) {
          badge.title = title;
        }
        if (ariaLabel) {
          badge.setAttribute('aria-label', ariaLabel);
        }
        if (role) {
          badge.setAttribute('role', role);
        }
        if (tone) {
          badge.classList.add(`capability-badge--${tone}`);
        }
        if (warning) {
          badge.classList.add('capability-badge--warning');
        }
        return badge;
      };

      if (toy.requiresWebGPU) {
        const hasWebGPU =
          typeof navigator !== 'undefined' && Boolean(navigator.gpu);
        metaRow.appendChild(
          createBadge({
            label: 'WebGPU',
            title: hasWebGPU
              ? 'Requires WebGPU to run.'
              : 'WebGPU not detected; falling back to WebGL if available.',
            ariaLabel: 'Requires WebGPU',
            role: 'status',
            warning: !hasWebGPU,
            tone: 'webgpu',
          }),
        );

        if (!hasWebGPU) {
          const fallbackNote = document.createElement('span');
          fallbackNote.className = 'capability-note';
          fallbackNote.textContent =
            'No WebGPU detected — will try WebGL fallback.';
          metaRow.appendChild(fallbackNote);
        }
      }

      if (toy.capabilities?.microphone) {
        metaRow.appendChild(
          createBadge({
            label: 'Mic',
            title: 'Uses live microphone input.',
            ariaLabel: 'Requires microphone input',
            tone: 'primary',
          }),
        );
      }

      if (toy.capabilities?.demoAudio) {
        metaRow.appendChild(
          createBadge({
            label: 'Demo audio',
            title: 'Includes a demo track if you skip the mic.',
            ariaLabel: 'Demo audio available',
            tone: 'soft',
          }),
        );
      }

      if (toy.capabilities?.motion) {
        metaRow.appendChild(
          createBadge({
            label: 'Motion',
            title: 'Responds to device motion or tilt.',
            ariaLabel: 'Requires device motion',
            tone: 'motion',
          }),
        );
      }

      if (metaRow.childElementCount > 0) {
        card.appendChild(metaRow);
      }
    }

    if (toy.type === 'module') {
      const actions = document.createElement('div');
      actions.className = 'webtoy-card-actions';

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'cta-button cta-button--accent';
      open.textContent = 'Open toy';
      open.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openToy(toy);
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
        ? toy.capabilities?.microphone
          ? 'Preview with demo audio'
          : 'Preview demo visuals'
        : toy.capabilities?.microphone
          ? 'Start mic-reactive mode'
          : 'Play now';
      play.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openToy(toy, { preferDemoAudio: Boolean(toy.capabilities?.demoAudio) });
      });
      play.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.stopPropagation();
        }
      });

      actions.appendChild(play);

      card.appendChild(actions);
    }

    card.addEventListener('click', (event) => {
      event.stopPropagation();
      handleOpenToy(toy, event);
    });

    if (enableKeyboardHandlers) {
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpenToy(toy, event);
        }
      });
    }

    return card;
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
      const toy = allToys.find((entry) => entry.slug === slug);
      if (!toy) return;
      handleOpenToy(toy, event);
    });
  };

  const renderToys = (listToRender) => {
    const list = document.getElementById(targetId);
    if (!list) return;
    list.innerHTML = '';
    if (listToRender.length === 0) {
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
      resetButton.textContent = 'Reset search and filters';
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

      emptyState.appendChild(message);
      emptyState.appendChild(resetButton);

      if (collapseSuggestions) {
        const suggestionsDisclosure = document.createElement('details');
        suggestionsDisclosure.className = 'empty-state__suggestions';

        const summary = document.createElement('summary');
        summary.textContent = 'Try suggestions';

        suggestionsDisclosure.appendChild(summary);
        suggestionsDisclosure.appendChild(quickActions);
        emptyState.appendChild(suggestionsDisclosure);
      } else {
        emptyState.appendChild(quickActions);
      }

      list.appendChild(emptyState);
      updateResultsMeta(0);
      updateActiveFiltersSummary();
      return;
    }

    renderGrowthPanels(list);
    listToRender.forEach((toy) => list.appendChild(createCard(toy)));
    updateResultsMeta(listToRender.length);
    updateActiveFiltersSummary();
  };

  const filterToys = (query) => {
    searchQuery = query;
    syncRefineDisclosure();
    renderToys(applyFilters());
    updateSearchClearState();
    updateActiveFiltersSummary();
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

  const clearFilters = () => {
    activeFilters.clear();
    const chips = document.querySelectorAll('[data-filter-chip].is-active');
    chips.forEach((chip) => {
      chip.classList.remove('is-active');
      updateFilterChipA11y(chip, false);
    });
    emitFilterStateChange();
    commitState({ replace: false });
    syncRefineDisclosure();
    renderToys(applyFilters());
    updateFilterResetState();
    updateActiveFiltersSummary();
  };

  const removeFilterToken = (token) => {
    const [type, value] = token.split(':');
    if (!type || !value) return;
    activeFilters.delete(token);
    const chips = document.querySelectorAll('[data-filter-chip]');
    chips.forEach((chip) => {
      const chipType = chip.getAttribute('data-filter-type');
      const chipValue = chip.getAttribute('data-filter-value');
      const chipToken =
        chipType && chipValue ? createFilterToken(chipType, chipValue) : null;
      if (chipToken === token) {
        chip.classList.remove('is-active');
        updateFilterChipA11y(chip, false);
      }
    });
    emitFilterStateChange();
    commitState({ replace: false });
    syncRefineDisclosure();
    renderToys(applyFilters());
    updateFilterResetState();
    updateActiveFiltersSummary();
  };

  const populateSearchSuggestions = () => {
    const datalist = ensureSearchSuggestions();
    if (!datalist) return;
    datalist.innerHTML = '';
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
    Array.from(suggestions)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .forEach((suggestion) => {
        const option = document.createElement('option');
        option.value = suggestion;
        datalist.appendChild(option);
      });
  };

  const initFilters = () => {
    const chips = document.querySelectorAll('[data-filter-chip]');
    chips.forEach((chip) => {
      updateFilterChipA11y(chip, chip.classList.contains('is-active'));
      chip.addEventListener('click', () => {
        const type = chip.getAttribute('data-filter-type');
        const value = chip.getAttribute('data-filter-value');
        if (!type || !value) return;
        const token = createFilterToken(type, value);
        if (!token) return;
        const isActive = chip.classList.toggle('is-active');
        updateFilterChipA11y(chip, isActive);
        emitFilterStateChange();
        if (isActive) {
          activeFilters.add(token);
        } else {
          activeFilters.delete(token);
        }
        commitState({ replace: false });
        renderToys(applyFilters());
        updateFilterResetState();
        updateActiveFiltersSummary();
      });
    });

    const sortControl = document.querySelector('[data-sort-control]');
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
      resetButton.addEventListener('click', () => clearFilters());
      updateFilterResetState();
    }

    const clearButton = ensureActiveFiltersClear();
    if (
      clearButton instanceof HTMLElement &&
      clearButton.tagName === 'BUTTON'
    ) {
      clearButton.addEventListener('click', () => clearFilters());
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

    const shortcutsToggle = document.querySelector(
      '[data-search-shortcuts-toggle]',
    );
    const shortcutsHint = document.getElementById('toy-search-hint');
    if (
      shortcutsToggle instanceof HTMLElement &&
      shortcutsToggle.tagName === 'BUTTON' &&
      shortcutsHint
    ) {
      shortcutsToggle.addEventListener('click', () => {
        const expanded =
          shortcutsToggle.getAttribute('aria-expanded') === 'true';
        shortcutsToggle.setAttribute(
          'aria-expanded',
          expanded ? 'false' : 'true',
        );
        shortcutsHint.hidden = expanded;
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
      openToy(quickLaunchToy);
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
    const hasUrlState = urlState.filters.length || urlState.sort !== 'featured';
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
