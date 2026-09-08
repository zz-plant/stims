/**
 * Whether the visitor has asked to stay on the preset they are watching.
 *
 * The behaviour has shipped for as long as the MilkDrop keybindings have:
 * `L` toggles it, and the runtime gates autoplay on it. What it never had
 * was a way for the React shell to see it. The flag lived as a closure
 * variable inside the runtime's interaction presenter, so the only route to
 * it was a keystroke on a document handler — no button, no palette entry,
 * and nothing in the chrome that could show it was on. Someone who settled
 * into a preset and did not want it taken away had to know a letter.
 *
 * A module store rather than a value threaded through the engine adapter,
 * for the same reason `audio-gesture-gate.ts` is one: both the runtime and
 * the UI need it, neither owns the other, and the alternative is a prop
 * drilled through every layer between them.
 *
 * Deliberately not persisted, unlike `live-performance-mode.ts`. Locking is
 * about *this* preset in *this* sitting; restoring it on the next visit
 * would silently disable autoplay for someone with no memory of asking.
 *
 * One store per document, which is the same scope `audio-gesture-gate.ts` and
 * `live-performance-mode.ts` take and the same scope the shell's single stage
 * has. A page running several experiences at once — the catalog tile lab,
 * preview capture alongside the stage — shares one lock between them. That is
 * why `createMilkdropExperience().dispose()` clears it: a module store does
 * not die with the instance that set it, and inheriting a previous
 * experience's lock reads as autoplay being broken.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let locked = false;

/** True while auto-advance is being held off by the visitor's request. */
export function isPresetLocked(): boolean {
  return locked;
}

export function subscribePresetLock(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPresetLocked(next: boolean): void {
  if (next === locked) {
    return;
  }
  locked = next;
  for (const listener of listeners) {
    listener();
  }
}

/** Flips the lock and reports the new state, for callers that announce it. */
export function togglePresetLock(): boolean {
  setPresetLocked(!locked);
  return locked;
}

/** Test seam: drop subscribers and the latched value between cases. */
export function resetPresetLock(): void {
  listeners.clear();
  locked = false;
}
