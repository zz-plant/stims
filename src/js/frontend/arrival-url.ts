/**
 * The URL the visitor actually arrived on, frozen before the app can touch it.
 *
 * Several decisions turn on "did they ask for this, or did we?" — most
 * visibly `NewHomePage`, which auto-starts a session for a `?preset=` arrival
 * because a social card advertised that one preset by name. Reading
 * `location.search` at the point of the decision cannot answer that: the app
 * writes to the address bar itself (`replaceState` in `workspace-hooks.ts`),
 * so by then its own writes are indistinguishable from the visitor's link.
 *
 * Reading it at *module scope of the consumer* is not enough either, and that
 * is the bug this module exists to close. Panels are lazy chunks: their module
 * bodies evaluate whenever the chunk finishes downloading, which on a cold
 * cache can land after the app has already rewritten the URL. The snapshot has
 * to be taken by the entry graph, which is why `app.ts` imports this eagerly —
 * that pins it to document load, before React mounts and before any route
 * effect can run.
 *
 * Keep the eager import in `app.ts`. Without it this module is only pulled in
 * by lazy consumers and the snapshot drifts back to chunk-load time.
 */

import { consumeRendererFallbackReload } from '../core/state/renderer-fallback-reload.ts';

const ARRIVAL_SEARCH =
  typeof window === 'undefined' ? '' : window.location.search;

// Read once, here, for the same reason as the URL: the marker is one-shot,
// and a lazy consumer reading it later could find it already gone.
const ARRIVAL_FROM_RENDERER_FALLBACK =
  typeof window !== 'undefined' &&
  consumeRendererFallbackReload(
    new URLSearchParams(ARRIVAL_SEARCH).get('preset'),
  );

/** Raw query string the document loaded with. */
export function getArrivalSearch(): string {
  return ARRIVAL_SEARCH;
}

/** One parameter from the arrival URL, or null when it was not present. */
export function getArrivalParam(name: string): string | null {
  if (!ARRIVAL_SEARCH) {
    return null;
  }
  return new URLSearchParams(ARRIVAL_SEARCH).get(name);
}

/** `?preset=` as the visitor arrived, never as the app later rewrote it. */
export function getArrivalPresetId(): string | null {
  return getArrivalParam('preset');
}

/**
 * `?audio=` as the visitor arrived. A copied link carries the sender's
 * source (`url-state.ts` writes it), so a recipient can be offered the same
 * one instead of silently landing on the demo track.
 */
export function getArrivalAudioSource(): string | null {
  return getArrivalParam('audio');
}

/**
 * This load is Stims's own reload into WebGL (`renderer-fallback-reload.ts`),
 * not a link the visitor followed: its `?preset=` and `?audio=` are the
 * visitor's own session, not a sender's.
 */
export function isArrivalRendererFallbackReload(): boolean {
  return ARRIVAL_FROM_RENDERER_FALLBACK;
}
