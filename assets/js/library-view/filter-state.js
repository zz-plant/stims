export const FILTER_PARAM = 'filters';
export const SORT_PARAM = 'sort';

export const normalizeCapabilityToken = (value) => {
  const normalized = value.toLowerCase();
  if (normalized === 'demoaudio' || normalized === 'demo-audio') {
    return 'demoAudio';
  }
  return normalized;
};

export const normalizeMoodToken = (value) => {
  const normalized = value.toLowerCase();
  if (normalized === 'calm') return 'calming';
  return normalized;
};

export const normalizeFilterToken = (token) => {
  if (typeof token !== 'string') return null;
  const [type, ...valueParts] = token.split(':');
  const value = valueParts.join(':').trim();
  if (!type || !value) return null;
  if (type === 'mood') {
    return `mood:${normalizeMoodToken(value)}`;
  }
  return `${type}:${value.toLowerCase()}`;
};

export const createFilterToken = (type, value) =>
  normalizeFilterToken(`${type}:${value}`);

export const parseFilters = (value) => {
  if (!value) return [];
  return value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
};

export const getStateFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const filters = parseFilters(params.get(FILTER_PARAM));
  const sort = params.get(SORT_PARAM) ?? 'featured';
  return { query: '', filters, sort };
};

export const stateToParams = (state) => {
  const params = new URLSearchParams(window.location.search);
  if (state.filters?.length) {
    params.set(FILTER_PARAM, state.filters.join(','));
  } else {
    params.delete(FILTER_PARAM);
  }
  if (state.sort && state.sort !== 'featured') {
    params.set(SORT_PARAM, state.sort);
  } else {
    params.delete(SORT_PARAM);
  }
  return params;
};

export const resolvePathname = () => {
  if (window.location?.pathname) return window.location.pathname;
  if (window.location?.href) {
    try {
      return new URL(window.location.href).pathname;
    } catch (_error) {
      return '/';
    }
  }
  return '/';
};

export const createLibraryStateStorage = ({ storageKey }) => ({
  saveStateToStorage(state) {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch (error) {
      console.warn('Unable to persist library state', error);
    }
  },

  readStateFromStorage() {
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (error) {
      console.warn('Unable to restore library state', error);
    }
    return null;
  },
});
