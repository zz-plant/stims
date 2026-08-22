/**
 * Whether audio is running but silent because the browser is still holding it
 * for a user gesture.
 *
 * Autoplay policy suspends an AudioContext created outside a click, and a
 * suspended context is indistinguishable from a working one from the UI's
 * side: the session reports `audioActive`, the stage animates, the analyser
 * returns zeros, and nothing plays. That combination arrives by design on the
 * deep-link path — a `?preset=` arrival starts demo audio without waiting for
 * a click, because the visitor came to watch that preset — so the visitor is
 * shown visuals with no sound and no explanation.
 *
 * `audio-handler.ts` already resumes every registered context on the first
 * pointerdown/touchstart/keydown. This module is the missing half: it makes
 * that pending state observable, so the UI can say "click for sound" and take
 * the message away the instant the click happens. Nothing here resumes
 * anything; it only reports.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let awaitingGesture = false;

/**
 * Reported to the UI. True means: audio is set up, and silent until the
 * visitor interacts with the page.
 */
export function isAudioAwaitingGesture(): boolean {
  return awaitingGesture;
}

export function subscribeAudioGestureGate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Called by `audio-handler.ts` whenever the set of registered contexts, or
 * any context's state, changes. Idempotent: notifying on an unchanged value
 * would re-render every subscriber on every `statechange`.
 */
export function reportAudioAwaitingGesture(next: boolean): void {
  if (next === awaitingGesture) {
    return;
  }
  awaitingGesture = next;
  for (const listener of listeners) {
    listener();
  }
}

/** Test seam: drop subscribers and the latched value between cases. */
export function resetAudioGestureGate(): void {
  listeners.clear();
  awaitingGesture = false;
}
