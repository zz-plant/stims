/**
 * Theme preference store.
 *
 * `theme` is what the user chose; `system` means "follow the OS". Everything
 * that paints reads `resolveTheme()`, which collapses that choice down to the
 * two values the stylesheets actually key off (`html.light` / `html.dark`).
 *
 * The default stays `dark` rather than `system` on purpose. The light theme
 * shipped fully styled but with no control to reach it, so it has never been
 * exercised by real traffic — defaulting to `system` would hand it to every
 * visitor on a light-mode OS in one release. Making it an explicit choice
 * gets it in front of users who opt in first. Revisit the default once it has
 * had some real mileage.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';

export type ThemePreference = {
  theme: ThemeChoice;
};

type ThemeSubscriber = (preference: ThemePreference) => void;

const THEME_PREFERENCE_KEY = 'stims:theme';

const subscribers = new Set<ThemeSubscriber>();
let activePreference: ThemePreference | null = null;
let systemQuery: MediaQueryList | null = null;
let systemListener: ((event: MediaQueryListEvent) => void) | null = null;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (error) {
    console.debug('localStorage unavailable', error);
    return null;
  }
}

function normalizeChoice(raw: string | null | undefined): ThemeChoice {
  if (raw === 'light' || raw === 'system') return raw;
  return 'dark';
}

function readFromStorage(): ThemePreference {
  try {
    return {
      theme: normalizeChoice(getStorage()?.getItem(THEME_PREFERENCE_KEY)),
    };
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

/** Collapse a stored choice into the theme to actually paint. */
export function resolveTheme(
  preference: ThemePreference = getActiveThemePreference(),
): 'light' | 'dark' {
  if (preference.theme !== 'system') return preference.theme;
  try {
    if (typeof matchMedia !== 'function') return 'dark';
    return matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  } catch {
    return 'dark';
  }
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
  if (systemQuery && systemListener) {
    systemQuery.removeEventListener('change', systemListener);
  }
  systemQuery = null;
  systemListener = null;
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

/**
 * Paint the active preference and keep it painted: re-applies on every
 * preference change, and — while the choice is `system` — on OS theme flips
 * too, so the app tracks a scheduled light/dark switch without a reload.
 * Returns an unsubscribe.
 */
export function startThemeSync(): () => void {
  const repaint = () => applyTheme(resolveTheme());
  repaint();

  const unsubscribe = subscribeToThemePreference(repaint);

  try {
    if (typeof matchMedia === 'function') {
      systemQuery = matchMedia('(prefers-color-scheme: light)');
      systemListener = () => {
        if (getActiveThemePreference().theme === 'system') repaint();
      };
      systemQuery.addEventListener('change', systemListener);
    }
  } catch (error) {
    console.debug('prefers-color-scheme watch unavailable', error);
  }

  return () => {
    unsubscribe();
    if (systemQuery && systemListener) {
      systemQuery.removeEventListener('change', systemListener);
    }
    systemQuery = null;
    systemListener = null;
  };
}
