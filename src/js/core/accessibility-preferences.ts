export type TextScale = 1 | 1.25 | 1.5 | 2;

export type AccessibilityPreference = {
  textScale: TextScale;
  highContrast: boolean;
  freezeFrame: boolean;
  /**
   * Hide presets measured above the WCAG 2.3.1 flash threshold from browse
   * and shuffle. Defaults on when the OS asks for reduced motion — someone
   * who has already said "less movement" should not have to find this
   * switch before the catalog stops handing them strobing presets.
   */
  reduceFlashing: boolean;
  /**
   * A ceiling on stage brightness, 0.3–1.
   *
   * A real limit, not a hint: it is applied as a CSS filter over the
   * presented canvas, so it holds for every preset on either backend and
   * cannot be undone by preset code. It composes with the flash governor's
   * own clamp (see `stage-luminance.ts`) — whichever is darker wins, because
   * they multiply.
   */
  stageBrightness: number;
};

/** Below this the stage is effectively black, which is not a comfort setting. */
export const MIN_STAGE_BRIGHTNESS = 0.3;

export function clampStageBrightness(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(MIN_STAGE_BRIGHTNESS, value));
}

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

// Until the user makes an explicit in-app choice, honor the motion
// preference they already expressed at the OS level.
function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

// Until the user makes an explicit in-app choice, honor the contrast
// preference they already expressed at the OS level.
function prefersMoreContrast(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-contrast: more)').matches
    );
  } catch {
    return false;
  }
}

function readFromStorage(): AccessibilityPreference {
  const storage = getStorage();
  const raw = storage?.getItem(ACCESSIBILITY_PREFERENCE_KEY);
  if (!raw) {
    return {
      textScale: 1,
      highContrast: prefersMoreContrast(),
      freezeFrame: false,
      reduceFlashing: prefersReducedMotion(),
      stageBrightness: 1,
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AccessibilityPreference>;
    return {
      textScale: clampTextScale(parsed.textScale),
      highContrast: parsed.highContrast === true,
      freezeFrame: parsed.freezeFrame === true,
      // Absent from a preference saved before this field existed: fall back
      // to the OS signal rather than to a bare false.
      reduceFlashing:
        typeof parsed.reduceFlashing === 'boolean'
          ? parsed.reduceFlashing
          : prefersReducedMotion(),
      stageBrightness: clampStageBrightness(parsed.stageBrightness),
    };
  } catch {
    return {
      textScale: 1,
      highContrast: prefersMoreContrast(),
      freezeFrame: false,
      reduceFlashing: prefersReducedMotion(),
      stageBrightness: 1,
    };
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
