export type ThemePreference = {
  theme: 'light' | 'dark';
};

type ThemeSubscriber = (preference: ThemePreference) => void;

const THEME_PREFERENCE_KEY = 'stims:theme';

const subscribers = new Set<ThemeSubscriber>();
let activePreference: ThemePreference | null = null;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (error) {
    console.debug('localStorage unavailable', error);
    return null;
  }
}

function readFromStorage(): ThemePreference {
  try {
    const raw = getStorage()?.getItem(THEME_PREFERENCE_KEY);
    if (raw === null || raw === undefined) return { theme: 'dark' };
    return { theme: raw === 'light' ? 'light' : 'dark' };
  } catch (error) {
    console.debug('Unable to read theme preference', error);
    return { theme: 'dark' };
  }
}

function persistToStorage(preference: ThemePreference) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(THEME_PREFERENCE_KEY, preference.theme);
  } catch (error) {
    console.debug('Unable to persist theme preference', error);
  }
}

export function getActiveThemePreference(): ThemePreference {
  if (!activePreference) {
    activePreference = readFromStorage();
  }
  return activePreference;
}

export function setThemePreference(update: Partial<ThemePreference>) {
  const current = getActiveThemePreference();
  const next = {
    ...current,
    ...update,
    theme: update.theme ?? current.theme,
  };
  activePreference = next;
  persistToStorage(next);
  subscribers.forEach((subscriber) => subscriber(next));
  return next;
}

export function subscribeToThemePreference(subscriber: ThemeSubscriber) {
  subscribers.add(subscriber);
  if (activePreference) {
    subscriber(activePreference);
  }
  return () => {
    subscribers.delete(subscriber);
  };
}

export function resetThemePreferenceState() {
  activePreference = null;
  subscribers.clear();
}

export function applyTheme(theme: 'light' | 'dark') {
  const html = document.documentElement;
  if (theme === 'light') {
    html.classList.add('light');
    html.classList.remove('dark');
  } else {
    html.classList.remove('light');
    html.classList.add('dark');
  }
}
