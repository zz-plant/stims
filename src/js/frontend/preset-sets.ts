import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { readStored, writeStored } from '../core/state/browser-storage.ts';

export const PRESET_SETS_STORAGE_KEY = 'stims:preset-sets:v1';
export const MAX_PRESETS_PER_SET = 50;
export const MAX_SET_TITLE_LENGTH = 100;
export const MAX_SAVED_SETS_COUNT = 50;
export const MAX_DECODED_SET_BYTES = 4096;
export const SET_PAYLOAD_PREFIX = 's1~';

export interface SavedPresetSet {
  id: string;
  title: string;
  presetIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SharedPresetSetPayload {
  v: 1;
  title: string;
  presets: string[];
}

export type PresetSetDecodeResult =
  | { ok: true; set: SharedPresetSetPayload }
  | { ok: false; error: string };

function base64UrlFromBase64(base64: string): string {
  return base64.replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function base64UrlToBase64(base64Url: string): string {
  const bare = base64Url.replace(/-/gu, '+').replace(/_/gu, '/');
  return `${bare}${'='.repeat((4 - (bare.length % 4)) % 4)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function sanitizeSetTitle(rawTitle: string): string {
  const trimmed = rawTitle.trim();
  if (!trimmed) return 'Untitled Set';
  return Array.from(trimmed).slice(0, MAX_SET_TITLE_LENGTH).join('');
}

export function readSavedPresetSets(): SavedPresetSet[] {
  try {
    const raw = readStored(PRESET_SETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.sets)) return [];
    return parsed.sets
      .filter((s: unknown): s is SavedPresetSet => {
        if (!s || typeof s !== 'object') return false;
        const candidate = s as Partial<SavedPresetSet>;
        return (
          typeof candidate.id === 'string' &&
          typeof candidate.title === 'string' &&
          Array.isArray(candidate.presetIds) &&
          candidate.presetIds.every((id) => typeof id === 'string')
        );
      })
      .map((s: SavedPresetSet) => ({
        id: s.id,
        title: sanitizeSetTitle(s.title),
        presetIds: s.presetIds.slice(0, MAX_PRESETS_PER_SET),
        createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
        updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
      }))
      .slice(0, MAX_SAVED_SETS_COUNT);
  } catch {
    return [];
  }
}

export function writeSavedPresetSets(sets: SavedPresetSet[]): void {
  const bounded = sets.slice(0, MAX_SAVED_SETS_COUNT).map((s) => ({
    id: s.id,
    title: sanitizeSetTitle(s.title),
    presetIds: s.presetIds.slice(0, MAX_PRESETS_PER_SET),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));
  writeStored(PRESET_SETS_STORAGE_KEY, JSON.stringify({ sets: bounded }));
}

export function saveNamedSet(
  title: string,
  presetIds: string[],
): SavedPresetSet {
  const cleanTitle = sanitizeSetTitle(title);
  const cleanIds = Array.from(new Set(presetIds)).slice(0, MAX_PRESETS_PER_SET);
  const now = Date.now();
  const newSet: SavedPresetSet = {
    id: `set-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: cleanTitle,
    presetIds: cleanIds,
    createdAt: now,
    updatedAt: now,
  };
  const current = readSavedPresetSets();
  writeSavedPresetSets([newSet, ...current]);
  return newSet;
}

export function deleteSavedPresetSet(id: string): void {
  const current = readSavedPresetSets();
  writeSavedPresetSets(current.filter((s) => s.id !== id));
}

export function encodePresetSetPayload(
  title: string,
  presetIds: string[],
): string {
  const cleanTitle = sanitizeSetTitle(title);
  const cleanIds = presetIds.slice(0, MAX_PRESETS_PER_SET);
  const payload: SharedPresetSetPayload = {
    v: 1,
    title: cleanTitle,
    presets: cleanIds,
  };
  const jsonStr = JSON.stringify(payload);
  const compressed = deflateSync(strToU8(jsonStr));
  const base64Url = base64UrlFromBase64(bytesToBase64(compressed));
  return `${SET_PAYLOAD_PREFIX}${base64Url}`;
}

/**
 * Inflates DEFLATE data with a hard cap on decoded size, enforced during
 * decompression rather than after. `set` comes from an untrusted shared URL,
 * and a high-ratio DEFLATE payload can expand far past MAX_DECODED_SET_BYTES
 * before a post-inflation length check runs. fflate's `out` option writes into
 * a caller-provided buffer and never grows it, so the full expanded form is
 * never allocated: output past the cap is truncated to the cap, and the
 * returned length exceeding the cap is how truncation is detected.
 */
function boundedInflate(
  bytes: Uint8Array,
  maxBytes: number,
): Uint8Array | null {
  const cap = new Uint8Array(maxBytes + 1);
  const decompressed = inflateSync(bytes, { out: cap });
  return decompressed.length > maxBytes ? null : decompressed;
}

export function decodePresetSetPayload(raw: string): PresetSetDecodeResult {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'Empty set payload' };
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith(SET_PAYLOAD_PREFIX)) {
    return { ok: false, error: 'Unsupported set payload version' };
  }
  const payloadStr = trimmed.slice(SET_PAYLOAD_PREFIX.length);
  try {
    const base64 = base64UrlToBase64(payloadStr);
    const bytes = base64ToBytes(base64);
    // Bound during decompression, not after: `set` comes from an untrusted
    // shared URL, and a high-ratio DEFLATE payload can expand far past
    // MAX_DECODED_SET_BYTES before a post-inflation length check runs. The
    // streaming inflater reports chunks as it goes, so we stop accumulating
    // (and reject) the moment the decoded size passes the cap instead of
    // materialising the whole inflated output first.
    const decompressed = boundedInflate(bytes, MAX_DECODED_SET_BYTES);
    if (decompressed === null) {
      return { ok: false, error: 'Preset set payload exceeds size limit' };
    }
    const text = strFromU8(decompressed);
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'Malformed set payload JSON' };
    }
    if (parsed.v !== 1) {
      return { ok: false, error: 'Unsupported set version' };
    }
    if (typeof parsed.title !== 'string') {
      return { ok: false, error: 'Invalid set title in payload' };
    }
    if (!Array.isArray(parsed.presets)) {
      return { ok: false, error: 'Invalid presets list in payload' };
    }
    const cleanTitle = sanitizeSetTitle(parsed.title);
    const cleanIds = parsed.presets
      .filter(
        (id: unknown): id is string =>
          typeof id === 'string' && Boolean(id.trim()),
      )
      .slice(0, MAX_PRESETS_PER_SET);

    if (cleanIds.length === 0) {
      return { ok: false, error: 'Preset set contains no valid presets' };
    }

    return {
      ok: true,
      set: {
        v: 1,
        title: cleanTitle,
        presets: cleanIds,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: `Could not decode preset set: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

export function buildPresetSetShareUrl(
  input: string | URL,
  title: string,
  presetIds: string[],
): string {
  const url =
    typeof input === 'string'
      ? new URL(input, 'https://toil.fyi')
      : new URL(input.toString());
  const payload = encodePresetSetPayload(title, presetIds);
  url.searchParams.set('set', payload);
  return url.toString();
}
