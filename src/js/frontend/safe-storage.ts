/**
 * localStorage access that survives the environments where it throws.
 *
 * Safari private browsing, embedded webviews, and quota exhaustion make plain
 * `localStorage` calls throw rather than return null. Call sites each wrapped
 * their own `try {} catch {}`, which reads as a swallowed error and trips the
 * banned-pattern guard. Stored preferences are best-effort by design, so that
 * intent lives here once instead of at every call site.
 */

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStored(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
