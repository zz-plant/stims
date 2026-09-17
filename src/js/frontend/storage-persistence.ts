/**
 * Asks the browser not to evict what the user has made here.
 *
 * Stims keeps no accounts — the manifest says so — which means browser
 * storage *is* the account. Imported presets and their metadata live in
 * IndexedDB; saved favourites, ratings, drafts, MIDI rigs, pinned
 * parameters, the queue and rebound shortcuts live alongside in
 * localStorage. Without a persistence grant every byte of that is "best
 * effort" and the browser may drop it under storage pressure, with no
 * warning and nothing to restore from.
 *
 * ## Why this is not called on every write
 *
 * Chromium decides silently from engagement heuristics, so asking early
 * costs nothing there. Firefox shows the user a permission prompt. Wiring
 * this into the IndexedDB write path would fire it on an ordinary preset
 * view — an unprompted permission dialog seconds into a first visit, asking
 * to keep something the visitor has not made yet. So it is called from the
 * two moments that earn it instead: saving a preset, and importing one.
 */

/**
 * One attempt per page load, whatever the answer. A denied request must not
 * become a dialog on every subsequent save, and a granted one has nothing
 * left to ask for.
 */
let inFlight: Promise<boolean> | null = null;

export type PersistentStorageOutcome =
  | 'granted'
  | 'denied'
  | 'already-persisted'
  | 'unsupported';

async function requestOnce(): Promise<PersistentStorageOutcome> {
  if (typeof navigator === 'undefined') return 'unsupported';
  const storage = navigator.storage;
  if (!storage?.persist || !storage.persisted) return 'unsupported';

  try {
    if (await storage.persisted()) return 'already-persisted';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    // Private windows and some embedded contexts reject outright. Nothing
    // here is recoverable and nothing downstream depends on the answer.
    return 'unsupported';
  }
}

/**
 * Requests persistent storage, at most once per page load.
 *
 * Fire and forget: the return value is for tests and diagnostics, and a
 * refusal changes nothing about what the caller should do next — the write
 * still happens, it is just evictable.
 */
export function ensurePersistentStorage(): Promise<boolean> {
  inFlight ??= requestOnce().then(
    (outcome) => outcome === 'granted' || outcome === 'already-persisted',
  );
  return inFlight;
}

/** Test seam: forgets the cached attempt. */
export function resetPersistentStorageRequest(): void {
  inFlight = null;
}

/** The raw outcome, for a diagnostics readout. Does not consume the cache. */
export async function describePersistentStorage(): Promise<PersistentStorageOutcome> {
  return requestOnce();
}
