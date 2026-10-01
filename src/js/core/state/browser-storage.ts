/**
 * Web Storage access that survives the environments where it throws.
 *
 * Reading the `localStorage` property itself, before any `getItem`, throws a
 * SecurityError in a sandboxed iframe without `allow-same-origin`, in a
 * third-party iframe under an opaque-origin parent (the `?embed=true` player
 * that oEmbed hands to other sites), and when the user blocks site data.
 * `typeof localStorage` evaluates the same getter, so it is not a guard.
 * Safari private browsing and quota exhaustion make writes throw as well.
 *
 * Stored preferences are best-effort, so every read degrades to "nothing
 * stored" and every write reports whether it persisted. Go through these
 * helpers rather than touching the storage globals at a call site.
 */

// A denied page reads storage dozens of times while booting; one debug line
// says why its preferences do not stick, a stack trace per read is noise.
const reportedDenials = new Set<string>();

function reportDenied(name: string, error: unknown) {
  if (reportedDenials.has(name)) return;
  reportedDenials.add(name);
  console.debug(`${name} unavailable`, error);
}

export function getBrowserStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (error) {
    reportDenied('localStorage', error);
    return null;
  }
}

export function getBrowserSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch (error) {
    reportDenied('sessionStorage', error);
    return null;
  }
}

/** The stored value, or null when nothing is stored or storage is denied. */
export function readStored(key: string): string | null {
  try {
    return getBrowserStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Returns false (instead of throwing) when the value could not persist. */
export function writeStored(key: string, value: string): boolean {
  const storage = getBrowserStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Returns false (instead of throwing) when the key could not be removed. */
export function removeStored(key: string): boolean {
  const storage = getBrowserStorage();
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
