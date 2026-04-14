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

function normalizePanel(value: unknown) {
  const parsedValue = readSearchValue(value);
  const normalized = parsedValue?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return null;
  }

  const mappedValue =
    normalized === 'looks'
      ? 'browse'
      : normalized === 'inspect'
        ? 'inspector'
        : normalized;

  if (!VALID_PANELS.has(mappedValue as Exclude<PanelState, null>)) {
    return null;
  }

  return mappedValue as Exclude<PanelState, null>;
}

function normalizeAudioSource(value: unknown) {
  const parsedValue = readSearchValue(value);
  const normalized = parsedValue?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return null;
  }

  const mappedValue =
    normalized === 'sample'
      ? 'demo'
      : normalized === 'mic'
        ? 'microphone'
        : normalized;

  if (!VALID_AUDIO_SOURCES.has(mappedValue as AudioSource)) {
    return null;
  }

  return mappedValue as AudioSource;
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

  return readSessionRouteStateFromSearch({
    preset: url.searchParams.get('preset'),
    collection: url.searchParams.get('collection'),
    tool: url.searchParams.get('tool'),
    panel: url.searchParams.get('panel'),
    audio: url.searchParams.get('audio'),
    agent: url.searchParams.get('agent'),
    experience: url.searchParams.get('experience'),
  });
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

  const params = new URLSearchParams(url.search);
  [
    'experience',
    'panel',
    'tool',
    'preset',
    'collection',
    'audio',
    'agent',
  ].forEach((key) => {
    params.delete(key);
  });

  if (state.presetId) {
    params.set('preset', state.presetId);
  }
  if (state.collectionTag) {
    params.set('collection', state.collectionTag);
  }
  if (state.panel) {
    params.set('tool', state.panel);
  }
  if (state.audioSource) {
    params.set('audio', state.audioSource);
  }
  if (state.agentMode) {
    params.set('agent', 'true');
  }

  url.pathname = '/';
  url.search = params.toString();
  return url;
}

export function replaceCanonicalUrl(state: SessionRouteState) {
  if (typeof window === 'undefined') {
    return;
  }

  const nextUrl = buildCanonicalUrl(state, window.location);
  const currentUrl = new URL(window.location.href);
  if (nextUrl.toString() === currentUrl.toString()) {
    return;
  }

  window.history.replaceState({}, '', nextUrl);
}
