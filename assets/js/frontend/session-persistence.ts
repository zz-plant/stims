const STORAGE_KEY = 'stims:last-session';

interface PersistedSession {
  audioSource: string | null;
  presetId: string | null;
  collectionTag: string | null;
  panel: string | null;
  lastVisitedAt: number;
}

export function readPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed || typeof parsed.lastVisitedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePersistedSession(
  session: Omit<PersistedSession, 'lastVisitedAt'>,
): void {
  try {
    const data: PersistedSession = { ...session, lastVisitedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Silently fail
  }
}
