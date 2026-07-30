import { getBrowserSessionStorage } from './browser-storage.ts';

/**
 * Presets whose compiled descriptor plan cannot run on the WebGPU path need to
 * be rendered with WebGL. That is a property of the individual preset, not of
 * the device.
 *
 * This used to be recorded by switching on the global `compatibility-mode`
 * preference, which is persisted to localStorage — so a single unsupported
 * preset permanently downgraded the whole app to WebGL, for every other preset
 * and every future session, with no way back except clearing site data. It was
 * especially punishing on phones, which are the most likely to meet an
 * unsupported preset first.
 *
 * Instead we remember the specific presets, in sessionStorage, so the fallback
 * is scoped to the preset that needed it and does not outlive the tab.
 */
const PRESET_WEBGL_FALLBACK_KEY = 'stims:webgl-fallback-presets';

function readSet(): Set<string> {
  const storage = getBrowserSessionStorage();
  if (!storage) {
    return new Set();
  }

  try {
    const raw = storage.getItem(PRESET_WEBGL_FALLBACK_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((entry): entry is string => typeof entry === 'string'))
      : new Set();
  } catch (_error) {
    return new Set();
  }
}

function writeSet(presetIds: Set<string>) {
  const storage = getBrowserSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      PRESET_WEBGL_FALLBACK_KEY,
      JSON.stringify([...presetIds]),
    );
  } catch (_error) {
    // Storage full or blocked: the fallback simply will not survive the reload.
  }
}

export function markPresetNeedsWebgl(presetId: string) {
  if (!presetId) {
    return;
  }
  const presetIds = readSet();
  if (presetIds.has(presetId)) {
    return;
  }
  presetIds.add(presetId);
  writeSet(presetIds);
}

export function presetNeedsWebgl(presetId: string | null | undefined) {
  if (!presetId) {
    return false;
  }
  return readSet().has(presetId);
}

export function clearPresetWebglFallbacks() {
  const storage = getBrowserSessionStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(PRESET_WEBGL_FALLBACK_KEY);
  } catch (_error) {
    // Nothing to do — a stale entry only costs this preset its WebGPU path.
  }
}
