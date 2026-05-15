import {
  createLibraryStateStorage,
  getStateFromUrl,
  normalizeCapabilityToken,
  normalizeFilterToken,
  normalizeMoodToken,
  resolvePathname,
  stateToParams,
} from './filter-state.js';

export const DEFAULT_LIBRARY_SORT = 'featured';

export const getQueryTokens = (query) =>
  query
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);

export const buildToySearchMetadata = (toy) => {
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

export const createToySearchMetadataMap = (toys, getToyKey) =>
  new Map(
    toys.map((toy, index) => [
      getToyKey(toy, index),
      buildToySearchMetadata(toy),
    ]),
  );

export const normalizeLibraryState = (state = {}) => ({
  query: typeof state.query === 'string' ? state.query : '',
  filters: Array.from(
    new Set(
      (state.filters ?? [])
        .map((token) => normalizeFilterToken(token))
        .filter(Boolean),
    ),
  ),
  sort:
    typeof state.sort === 'string' && state.sort
      ? state.sort
      : DEFAULT_LIBRARY_SORT,
});

export const applyQuery = (state, query) => ({
  ...normalizeLibraryState(state),
  query: typeof query === 'string' ? query : '',
});

export const toggleFilter = (state, token) => {
  const normalizedState = normalizeLibraryState(state);
  const normalizedToken = normalizeFilterToken(token);
  if (!normalizedToken) {
    return { state: normalizedState, isActive: false, token: null };
  }

  const filters = new Set(normalizedState.filters);
  const isActive = !filters.has(normalizedToken);
  if (isActive) {
    filters.add(normalizedToken);
  } else {
    filters.delete(normalizedToken);
  }

  return {
    state: { ...normalizedState, filters: Array.from(filters) },
    isActive,
    token: normalizedToken,
  };
};

export const clearState = (state = {}) => ({
  ...normalizeLibraryState(state),
  query: '',
  filters: [],
  sort: DEFAULT_LIBRARY_SORT,
});

export const setSort = (state, sort) => ({
  ...normalizeLibraryState(state),
  sort: typeof sort === 'string' && sort ? sort : DEFAULT_LIBRARY_SORT,
});

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

const matchesSearchQuery = (_toy, queryTokens, metadata) => {
  if (queryTokens.length === 0) return true;
  const searchHaystacks = metadata?.searchHaystacks ?? [];
  return queryTokens.every((token) =>
    searchHaystacks.some((field) => field.includes(token)),
  );
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

const getFeaturedRank = (toy) =>
  Number.isFinite(toy.featuredRank)
    ? toy.featuredRank
    : Number.POSITIVE_INFINITY;

export const computeFilteredToys = ({
  toys,
  state,
  metadataByKey,
  getToyKey,
  originalOrder,
}) => {
  const normalizedState = normalizeLibraryState(state);
  const queryTokens = getQueryTokens(normalizedState.query);
  const filterTokens = normalizedState.filters;
  const getOriginalIndex = (toy, index = 0) =>
    originalOrder.get(getToyKey(toy, index)) ?? index;
  const shouldApplyLowSetupBoost =
    normalizedState.sort === DEFAULT_LIBRARY_SORT &&
    filterTokens.length === 0 &&
    normalizedState.query.trim().length > 0 &&
    !hasSetupIntentToken(normalizedState.query);

  const filtered = toys.filter((toy, index) => {
    const key = getToyKey(toy, index);
    const metadata = metadataByKey.get(key);
    const matchesChips =
      filterTokens.length === 0 ||
      filterTokens.every((token) => matchesFilter(toy, token));
    return matchesChips && matchesSearchQuery(toy, queryTokens, metadata);
  });

  const sorted = [...filtered];
  switch (normalizedState.sort) {
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
      if (shouldApplyLowSetupBoost) {
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

export const getMatchedFields = (
  toy,
  queryTokens,
  metadataByKey,
  getToyKey,
) => {
  if (!queryTokens.length) return [];

  const metadata = metadataByKey.get(getToyKey(toy));
  const fields = metadata?.fields;
  if (!fields) return [];

  const matchedSources = new Set();
  queryTokens.forEach((token) => {
    if (fields.title.includes(token)) matchedSources.add('Title');
    if (fields.slug.includes(token)) matchedSources.add('Slug');
    if (fields.description.includes(token)) matchedSources.add('Description');
    if (fields.tags.some((tag) => tag.includes(token)))
      matchedSources.add('Tags');
    if (fields.moods.some((mood) => mood.includes(token)))
      matchedSources.add('Moods');
    if (toy.requiresWebGPU && 'webgpu'.includes(token))
      matchedSources.add('WebGPU');
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

export const createLibraryStateController = ({
  storageKey,
  compatibilityModeKey = 'stims-compatibility-mode',
  windowObject = window,
}) => {
  const { saveStateToStorage, readStateFromStorage } =
    createLibraryStateStorage({ storageKey });
  let currentState = normalizeLibraryState();

  const getState = () => normalizeLibraryState(currentState);

  const setState = (nextState) => {
    currentState = normalizeLibraryState(nextState);
    return getState();
  };

  const commitState = ({ replace }) => {
    const state = getState();
    const params = stateToParams(state);
    const nextUrl = `${resolvePathname()}${params.toString() ? `?${params.toString()}` : ''}`;
    try {
      if (replace) {
        windowObject.history.replaceState(state, '', nextUrl);
      } else {
        windowObject.history.pushState(state, '', nextUrl);
      }
    } catch (_error) {
      // Ignore history errors in non-browser environments.
    }
    saveStateToStorage(state);
    return state;
  };

  const restoreInitialState = () => {
    const urlState = normalizeLibraryState(getStateFromUrl());
    const hasUrlState =
      urlState.query.trim().length > 0 ||
      urlState.filters.length > 0 ||
      urlState.sort !== DEFAULT_LIBRARY_SORT;
    if (hasUrlState) {
      return setState(urlState);
    }

    const storedState = readStateFromStorage();
    if (storedState) {
      return setState(storedState);
    }

    try {
      if (
        windowObject.sessionStorage.getItem(compatibilityModeKey) === 'true'
      ) {
        return setState({
          query: '',
          filters: ['feature:compatible'],
          sort: DEFAULT_LIBRARY_SORT,
        });
      }
    } catch (_error) {
      // Ignore storage access issues.
    }

    return getState();
  };

  return {
    getState,
    setState,
    applyQuery(query) {
      return setState(applyQuery(getState(), query));
    },
    toggleFilter(token) {
      const result = toggleFilter(getState(), token);
      setState(result.state);
      return result;
    },
    clearState() {
      return setState(clearState(getState()));
    },
    setSort(sort) {
      return setState(setSort(getState(), sort));
    },
    commitState,
    restoreInitialState,
    readStateFromUrl() {
      return normalizeLibraryState(getStateFromUrl());
    },
    readStateFromStorage() {
      return normalizeLibraryState(readStateFromStorage() ?? {});
    },
  };
};
