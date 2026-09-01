import { getBrowserStorage } from './browser-storage.ts';

export type ResumableAudioSource = 'demo' | 'microphone' | 'tab' | 'youtube';

export type LastSession = {
  presetId: string;
  presetTitle: string;
  source: ResumableAudioSource;
  savedAt: number;
};

const STORAGE_KEY = 'stims:last-session';

export function getLastSession(): LastSession | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastSession>;
    if (
      typeof parsed.presetId !== 'string' ||
      typeof parsed.presetTitle !== 'string' ||
      typeof parsed.savedAt !== 'number' ||
      (parsed.source !== 'demo' &&
        parsed.source !== 'microphone' &&
        parsed.source !== 'tab' &&
        parsed.source !== 'youtube')
    ) {
      return null;
    }
    return parsed as LastSession;
  } catch {
    return null;
  }
}

export function saveLastSession(session: Omit<LastSession, 'savedAt'>) {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...session, savedAt: Date.now() } satisfies LastSession),
    );
  } catch {
    // Storage unavailable or full — resume is a convenience, not required.
  }
}

// Captured once at module evaluation — the bundle loads before any user
// gesture can start audio and save the *current* session, so this stays an
// honest "had they been here before this visit" for the whole page life.
// Reading getLastSession() at component mount time cannot answer that
// question: entering live mode is what mounts the stage panels, and by then
// the session-save effect has usually already run.
const hadSessionAtBoot = getLastSession() !== null;

/**
 * True when a previous session existed before this page load — the same
 * signal the landing page uses for its "Welcome back" variant. First-use
 * teaching UI (the empty-state hints on the stage panels) keys off this so a
 * brand-new visitor's first minutes stay free of chrome.
 */
export function hadSessionBeforeBoot(): boolean {
  return hadSessionAtBoot;
}
