import type {
  AudioSource,
  PanelState,
  SessionRouteState,
} from './contracts.ts';

const VALID_PANELS = new Set<Exclude<PanelState, null>>([
  'browse',
  'editor',
  'inspector',
  'settings',
]);
const VALID_AUDIO_SOURCES = new Set<AudioSource>([
  'demo',
  'microphone',
  'tab',
  'youtube',
]);

const LEGACY_PANEL_ALIASES: Record<string, Exclude<PanelState, null>> = {
  looks: 'browse',
  inspect: 'inspector',
};

const LEGACY_AUDIO_ALIASES: Record<string, AudioSource> = {
  sample: 'demo',
  mic: 'microphone',
};

const SESSION_ROUTE_SEARCH_KEYS = [
  'experience',
  'panel',
  'tool',
  'preset',
  'collection',
  'audio',
  'agent',
] as const;

function readSearchValue(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const firstValue = value.find(
      (entry) =>
        typeof entry === 'string' ||
        typeof entry === 'number' ||
        typeof entry === 'boolean',
    );
    if (
      typeof firstValue === 'string' ||
      typeof firstValue === 'number' ||
      typeof firstValue === 'boolean'
    ) {
      return String(firstValue);
    }
  }

  return null;
}

function normalizeSearchEnum<T extends string>(
  value: unknown,
  validValues: Set<T>,
  aliases: Record<string, T> = {},
) {
  const parsedValue = readSearchValue(value);
  const normalized = parsedValue?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return null;
  }

  const mappedValue = aliases[normalized] ?? normalized;
  if (!validValues.has(mappedValue as T)) {
    return null;
  }

  return mappedValue as T;
}

function normalizePanel(value: unknown) {
  return normalizeSearchEnum(value, VALID_PANELS, LEGACY_PANEL_ALIASES);
}

function normalizeAudioSource(value: unknown) {
  return normalizeSearchEnum(value, VALID_AUDIO_SOURCES, LEGACY_AUDIO_ALIASES);
}

export function normalizeCollectionTag(value: unknown) {
  const parsedValue = readSearchValue(value);
  const normalized = parsedValue?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return null;
  }

  return normalized.startsWith('collection:')
    ? normalized
    : `collection:${normalized}`;
}

export function readSessionRouteStateFromSearch(
  search: Record<string, unknown>,
): SessionRouteState {
  const legacyExperience = readSearchValue(search.experience);

  return {
    presetId: readSearchValue(search.preset)?.trim() || null,
    collectionTag: normalizeCollectionTag(search.collection),
    panel: normalizePanel(search.tool ?? search.panel),
    audioSource: normalizeAudioSource(search.audio),
    agentMode: readSearchValue(search.agent) === 'true',
    invalidExperienceSlug:
      legacyExperience && legacyExperience !== 'milkdrop'
        ? legacyExperience
        : null,
  };
}

export function parsePlainSearch(searchStr: string) {
  const params = new URLSearchParams(
    searchStr.startsWith('?') ? searchStr.slice(1) : searchStr,
  );
  const search: Record<string, unknown> = {};

  for (const [key, value] of params) {
    const previousValue = search[key];
    if (typeof previousValue === 'undefined') {
      search[key] = value;
      continue;
    }

    search[key] = Array.isArray(previousValue)
      ? [...previousValue, value]
      : [previousValue, value];
  }

  return search;
}

export function stringifyPlainSearch(search: Record<string, unknown>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(search)) {
    if (value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry != null) {
          params.append(key, String(entry));
        }
      });
      continue;
    }

    params.set(key, String(value));
  }

  const serializedSearch = params.toString();
  return serializedSearch ? `?${serializedSearch}` : '';
}

export function buildSessionRouteSearch(
  state: SessionRouteState,
  search: Record<string, unknown>,
) {
  const nextSearch = { ...search };

  SESSION_ROUTE_SEARCH_KEYS.forEach((key) => {
    delete nextSearch[key];
  });

  if (state.presetId) {
    nextSearch.preset = state.presetId;
  }
  if (state.collectionTag) {
    nextSearch.collection = state.collectionTag;
  }
  if (state.panel) {
    nextSearch.tool = state.panel;
  }
  if (state.audioSource) {
    nextSearch.audio = state.audioSource;
  }
  if (state.agentMode) {
    nextSearch.agent = 'true';
  }

  return nextSearch;
}

export function readSessionRouteState(
  input: string | URL | Location | undefined = typeof window !== 'undefined'
    ? window.location
    : undefined,
): SessionRouteState {
  const url =
    typeof input === 'string'
      ? new URL(input, 'https://toil.fyi')
      : input instanceof URL
        ? input
        : new URL(input?.href ?? 'https://toil.fyi/');

  return readSessionRouteStateFromSearch(parsePlainSearch(url.search));
}

export function buildCanonicalUrl(
  state: SessionRouteState,
  input: string | URL | Location | undefined = typeof window !== 'undefined'
    ? window.location
    : undefined,
) {
  const url =
    typeof input === 'string'
      ? new URL(input, 'https://toil.fyi')
      : input instanceof URL
        ? new URL(input.toString())
        : new URL(input?.href ?? 'https://toil.fyi/');

  url.pathname = '/';
  url.search = stringifyPlainSearch(
    buildSessionRouteSearch(state, parsePlainSearch(url.search)),
  );
  return url;
}
