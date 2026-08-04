export type TextScale = 1 | 1.25 | 1.5 | 2;

export type AccessibilityPreference = {
  textScale: TextScale;
  highContrast: boolean;
  freezeFrame: boolean;
};

type AccessibilitySubscriber = (preference: AccessibilityPreference) => void;

const ACCESSIBILITY_PREFERENCE_KEY = 'stims:accessibility';

const subscribers = new Set<AccessibilitySubscriber>();
let activePreference: AccessibilityPreference | null = null;
let freezeFrameFlag = false;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readFromStorage(): AccessibilityPreference {
  const storage = getStorage();
  const raw = storage?.getItem(ACCESSIBILITY_PREFERENCE_KEY);
  if (!raw) {
    return { textScale: 1, highContrast: false, freezeFrame: false };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AccessibilityPreference>;
    return {
      textScale: clampTextScale(parsed.textScale),
      highContrast: parsed.highContrast === true,
      freezeFrame: parsed.freezeFrame === true,
    };
  } catch {
    return { textScale: 1, highContrast: false, freezeFrame: false };
  }
}

function clampTextScale(value: unknown): TextScale {
  if (value === 1.25 || value === 1.5 || value === 2) return value;
  return 1;
}

function persistToStorage(preference: AccessibilityPreference) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(ACCESSIBILITY_PREFERENCE_KEY, JSON.stringify(preference));
}

export function getActiveAccessibilityPreference(): AccessibilityPreference {
  if (!activePreference) {
    activePreference = readFromStorage();
    freezeFrameFlag = activePreference.freezeFrame;
  }
  return activePreference;
}

export function setAccessibilityPreference(
  update: Partial<AccessibilityPreference>,
) {
  const current = getActiveAccessibilityPreference();
  const next = { ...current, ...update };
  activePreference = next;
  freezeFrameFlag = next.freezeFrame;
  persistToStorage(next);
  applyAccessibility(next);
  subscribers.forEach((subscriber) => subscriber(next));
  return next;
}

export function subscribeToAccessibilityPreference(
  subscriber: AccessibilitySubscriber,
) {
  subscribers.add(subscriber);
  if (activePreference) {
    subscriber(activePreference);
  }
  return () => {
    subscribers.delete(subscriber);
  };
}

export function isFreezeFrameActive(): boolean {
  return freezeFrameFlag;
}

export function applyAccessibility(preference: AccessibilityPreference) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.style.setProperty('--ui-scale', String(preference.textScale));
  if (preference.highContrast) {
    html.setAttribute('data-contrast', 'high');
  } else {
    html.removeAttribute('data-contrast');
  }
}

export function resetAccessibilityPreferenceState() {
  activePreference = null;
  freezeFrameFlag = false;
  subscribers.clear();
}
