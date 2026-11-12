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
