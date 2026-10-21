import { getBrowserSessionStorage } from './browser-storage.ts';

/**
 * The page reload Stims performs itself when a preset cannot run on WebGPU
 * (see `milkdrop/runtime/backend-fallback.ts`).
 *
 * The reload re-enters with the preset pinned to WebGL, which is the point,
 * but to the visitor it was a page that blinked and dropped their audio. The
 * URL it reloads carries the session's own `?preset=` and `?audio=`, so the
 * next load read it as a link someone had shared with them. Two things need
 * to know it was ours: the outgoing page, whose leave-page guard must not
 * fire for it, and the arriving page, which explains what happened and
 * offers the visitor's own source back.
 */
const RENDERER_FALLBACK_RELOAD_KEY = 'stims:renderer-fallback-reload';

let reloadInFlight = false;

/**
 * Reload into WebGL for `presetId`, marked as Stims's own reload.
 *
 * `location` is injectable for tests; the runtime passes nothing.
 */
export function reloadForRendererFallback(
  presetId: string,
  location: Pick<Location, 'href' | 'replace' | 'reload'> = window.location,
) {
  reloadInFlight = true;
  const storage = getBrowserSessionStorage();
  try {
    storage?.setItem(RENDERER_FALLBACK_RELOAD_KEY, presetId);
  } catch (_error) {
    // Unwritable storage only costs the arrival its explanation. The WebGL
    // pin itself is persisted (and checked) before this runs.
  }
  // Carry the preset id in the URL so the reload's renderer selection can
  // see it: shouldPreferWebGLForKnownCompatibilityGaps only consults
  // ?preset=, and without it the reload mounts WebGPU again, hits the same
  // descriptor fallback, and reloads forever.
  const url = new URL(location.href);
  url.searchParams.set('preset', presetId);
  const target = url.toString();
  // Replacing a URL that carries a fragment (the editor's #code= draft) with
  // the same URL is a fragment navigation: nothing reloads, the preset stays
  // on WebGPU, and the page carries on believing it is going away.
  if (target === location.href) {
    location.reload();
    return;
  }
  location.replace(target);
}

/** True between the fallback starting its reload and the page unloading. */
export function isRendererFallbackReloadInFlight() {
  return reloadInFlight;
}

/**
 * Whether this page load is the fallback's reload for `arrivalPresetId`.
 *
 * One-shot: the marker is removed on read, so a later reload the visitor
 * makes themselves is theirs again. A marker naming another preset is stale
 * (a reload that never happened) and is dropped too.
 */
export function consumeRendererFallbackReload(
  arrivalPresetId: string | null,
): boolean {
  const storage = getBrowserSessionStorage();
  if (!storage) {
    return false;
  }
  try {
    const presetId = storage.getItem(RENDERER_FALLBACK_RELOAD_KEY);
    if (presetId === null) {
      return false;
    }
    storage.removeItem(RENDERER_FALLBACK_RELOAD_KEY);
    return arrivalPresetId !== null && presetId === arrivalPresetId;
  } catch (_error) {
    return false;
  }
}
