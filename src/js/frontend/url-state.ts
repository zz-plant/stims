import { resolveSemanticRoute } from '../../../functions/discover-slugs.ts';
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
  'embed',
  'chromeless',
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
    invalidPanel: parsed.routing.invalidPanel,
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

  const state = readSessionRouteStateFromSearch(parsePlainSearch(url.search));
  const discovery = resolveSemanticRoute(url.pathname);
  if (!discovery) return state;

  return {
    ...state,
    collectionTag: state.collectionTag ?? discovery.collectionTag ?? null,
    panel: state.panel ?? 'browse',
    discovery,
  };
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

/** Full URL for the current session's share state. Passing `source` adds a
 * `#code=` hash carrying the live-edited `.milk` source; passing `null`
 * removes any hash. Pathname and search are preserved so the preset,
 * collection, audio, and tool state in the query string keeps working.
 * Still returns the input unchanged if the hash cannot be built, so a failure
 * degrades to the plain view URL rather than wiping the session's other state
 * off the address bar — callers that announce "carries your edits" must check
 * for the hash rather than assume it. */
export function buildRemixShareUrl(
  input: string | URL,
  source: string | null,
): string {
  const url =
    typeof input === 'string'
      ? new URL(input, 'https://toil.fyi')
      : new URL(input.toString());
  if (source !== null) {
    const hash = buildPresetCodeHash(source);
    if (!hash) return typeof input === 'string' ? input : input.toString();
    url.hash = hash;
  } else {
    url.hash = '';
  }
  return url.toString();
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
    return decodeBase64ToText(decodeURIComponent(codeParam));
  } catch (_err) {
    try {
      return decodeBase64ToText(codeParam);
    } catch (_err2) {
      return null;
    }
  }
}

/**
 * Marks a payload as UTF-8 bytes rather than the Latin-1 ones links written
 * before this encoder carry.
 *
 * `~` is not in the base64 alphabet and `encodeURIComponent` leaves it
 * alone, so it cannot appear in a legacy payload and cannot change the shape
 * of the encoded hash. The digit is there so a third encoding, if one is
 * ever needed, does not have to guess again.
 *
 * The alternative — decoding as UTF-8 and falling back when that throws —
 * looks equivalent but is not: a Latin-1 source containing `Ã©` was stored
 * as the bytes `C3 A9`, which are perfectly valid UTF-8 for `é`, so the
 * strict decode succeeds and hands back source the author never wrote. An
 * explicit marker is the only way to tell the two apart.
 */
const PRESET_CODE_UTF8_PREFIX = 'u1~';

/**
 * Base64 for arbitrary text, via UTF-8.
 *
 * `btoa` takes a Latin-1 byte string, so it throws on any character above
 * U+00FF — one emoji or one CJK comment in a `.milk` source was enough to
 * make the whole remix link silently degrade to a plain view URL while the
 * UI still announced that it carried the draft. Encoding to UTF-8 first
 * removes the limit; the chunking keeps a large source off the argument
 * limit of a single spread call.
 */
function encodeTextToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/**
 * The inverse, reading the marker rather than guessing: a payload written by
 * this build decodes as UTF-8, and anything without the marker is a link
 * from an older build and is read back as the Latin-1 bytes it was written
 * with, exactly as that build read it.
 */
function decodeBase64ToText(payload: string): string {
  if (!payload.startsWith(PRESET_CODE_UTF8_PREFIX)) {
    return atob(payload);
  }
  const binary = atob(payload.slice(PRESET_CODE_UTF8_PREFIX.length));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function buildPresetCodeHash(milkSource: string): string {
  try {
    const base64 = encodeTextToBase64(milkSource);
    return `#code=${encodeURIComponent(`${PRESET_CODE_UTF8_PREFIX}${base64}`)}`;
  } catch (_err) {
    return '';
  }
}
