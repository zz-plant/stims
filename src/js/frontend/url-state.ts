import { normalizeCollectionTag, parseURLParams } from '../core/url-params.ts';
import type {
  AudioSource,
  PanelState,
  SessionRouteState,
} from './contracts.ts';

export { normalizeCollectionTag };

const SESSION_ROUTE_SEARCH_KEYS = [
  'experience',
  'panel',
  'tool',
  'preset',
  'collection',
  'audio',
  'agent',
  'embedded',
  'preview',
  'yt',
  't',
] as const;

export function readSessionRouteStateFromSearch(
  search: Record<string, unknown>,
): SessionRouteState {
  const parsed = parseURLParams(search);
  return {
    presetId: parsed.routing.presetId,
    collectionTag: parsed.routing.collectionTag,
    panel: parsed.routing.panel as PanelState,
    audioSource: parsed.routing.audioSource as AudioSource | null,
    agentMode: parsed.routing.agentMode,
    previewMode: parsed.routing.previewMode,
    invalidExperienceSlug: parsed.routing.invalidExperienceSlug,
    youtubeVideoId: parsed.routing.youtubeVideoId,
    youtubeStartSeconds: parsed.routing.youtubeStartSeconds,
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
  if (state.previewMode) {
    nextSearch.embedded = 'true';
  }
  if (state.invalidExperienceSlug) {
    nextSearch.experience = state.invalidExperienceSlug;
  }
  if (state.youtubeVideoId) {
    nextSearch.yt = state.youtubeVideoId;
    // Only carry an offset alongside a video — a bare `t` means nothing.
    if (state.youtubeStartSeconds && state.youtubeStartSeconds > 0) {
      nextSearch.t = String(Math.floor(state.youtubeStartSeconds));
    }
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

export function decodePresetCodeFromHash(
  hashInput: string = typeof window !== 'undefined' ? window.location.hash : '',
): string | null {
  const hash = hashInput.startsWith('#') ? hashInput.slice(1) : hashInput;
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const codeParam = params.get('code');
  if (!codeParam) return null;

  try {
    const raw = atob(decodeURIComponent(codeParam));
    return raw;
  } catch (_err) {
    try {
      return atob(codeParam);
    } catch (_err2) {
      return null;
    }
  }
}

export function buildPresetCodeHash(milkSource: string): string {
  try {
    const base64 = btoa(milkSource);
    return `#code=${encodeURIComponent(base64)}`;
  } catch (_err) {
    return '';
  }
}
