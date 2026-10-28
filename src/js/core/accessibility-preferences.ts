import { isRoomModeRequested } from './room-mode.ts';
import {
  type ComfortURLParams,
  isReduceFlashingRequested,
  parseURLParams,
} from './url-params.ts';

export type TextScale = 1 | 1.25 | 1.5 | 2;

export type AccessibilityPreference = {
  textScale: TextScale;
  highContrast: boolean;
  freezeFrame: boolean;
  /**
   * Hide presets measured above the WCAG 2.3.1 flash threshold from browse
   * and shuffle, and enable the live flash governor. Defaults on unless
   * the visitor has explicitly saved an opt-out. This mitigates flash
   * exposure; it does not establish that a preset is safe for everyone.
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
  /**
   * How much of the preset's camera motion — zoom, rotation, drift, warp —
   * reaches the screen, 0–1. Waveforms, shapes and colour still react to
   * the audio at 0; only the picture stops travelling. Defaults below 1
   * when the OS asks for reduced motion, for the same reason as
   * `reduceFlashing`.
   */
  motionScale: number;
};

/** Below this the stage is effectively black, which is not a comfort setting. */
export const MIN_STAGE_BRIGHTNESS = 0.3;

export function clampStageBrightness(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(MIN_STAGE_BRIGHTNESS, value));
}

/**
 * Where the motion slider rests when the OS asks for reduced motion and the
 * user has not touched it: most of the travel gone, enough left that a
 * preset still reads as alive rather than as a stuck frame.
 */
export const REDUCED_MOTION_DEFAULT_SCALE = 0.4;

export function clampMotionScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

type AccessibilitySubscriber = (preference: AccessibilityPreference) => void;

const ACCESSIBILITY_PREFERENCE_KEY = 'stims:accessibility';

const subscribers = new Set<AccessibilitySubscriber>();
let activePreference: AccessibilityPreference | null = null;
let freezeFrameFlag = false;
let motionScaleFlag = 1;
// The visitor's own choices. They differ from the active values while a link
// is in force (`?reduceFlashing=1`, `?room=1`, `?brightness=`, `?motion=`),
// and they are what is saved, so a shared screen's link never rewrites the
// settings on that device.
let savedPreference: AccessibilityPreference | null = null;

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

function urlRequestsReduceFlashing(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return isReduceFlashingRequested() || isRoomModeRequested();
  } catch {
    return false;
  }
}

function urlComfortRequest(): ComfortURLParams {
  const none = { stageBrightness: null, motionScale: null };
  if (typeof window === 'undefined') return none;
  try {
    return parseURLParams().comfort;
  } catch {
    return none;
  }
}

/**
 * What a link asks for on top of the saved preference. Every request only
 * calms: brightness and motion take the lower of the two, and reduce
 * flashing can be turned on but never off.
 */
function applyLinkComfort(
  saved: AccessibilityPreference,
  link: ComfortURLParams & { reduceFlashing: boolean },
): AccessibilityPreference {
  return {
    ...saved,
    reduceFlashing: saved.reduceFlashing || link.reduceFlashing,
    stageBrightness:
      link.stageBrightness === null
        ? saved.stageBrightness
        : Math.min(
            saved.stageBrightness,
            clampStageBrightness(link.stageBrightness),
          ),
    motionScale:
      link.motionScale === null
        ? saved.motionScale
        : Math.min(saved.motionScale, clampMotionScale(link.motionScale)),
  };
}

function defaultMotionScale(): number {
  return prefersReducedMotion() ? REDUCED_MOTION_DEFAULT_SCALE : 1;
}

function readFromStorage(): AccessibilityPreference {
  const storage = getStorage();
  const raw = storage?.getItem(ACCESSIBILITY_PREFERENCE_KEY);
  if (!raw) {
    return {
      textScale: 1,
      highContrast: prefersMoreContrast(),
      freezeFrame: false,
      reduceFlashing: true,
      stageBrightness: 1,
      motionScale: defaultMotionScale(),
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AccessibilityPreference>;
    return {
      textScale: clampTextScale(parsed.textScale),
      highContrast: parsed.highContrast === true,
      freezeFrame: parsed.freezeFrame === true,
      // Absent from a preference saved before this field existed: fall back
      // to protection rather than to a bare false.
      reduceFlashing:
        typeof parsed.reduceFlashing === 'boolean'
          ? parsed.reduceFlashing
          : true,
      stageBrightness: clampStageBrightness(parsed.stageBrightness),
      motionScale:
        typeof parsed.motionScale === 'number'
          ? clampMotionScale(parsed.motionScale)
          : defaultMotionScale(),
    };
  } catch {
    return {
      textScale: 1,
      highContrast: prefersMoreContrast(),
      freezeFrame: false,
      reduceFlashing: true,
      stageBrightness: 1,
      motionScale: defaultMotionScale(),
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
    const stored = readFromStorage();
    savedPreference = stored;
    // A shared screen (a party display, an OBS source, an embed, a sensory
    // room) is watched by people who never opened Settings, so its link can
    // ask for a calmer stage.
    activePreference = applyLinkComfort(stored, {
      ...urlComfortRequest(),
      reduceFlashing: urlRequestsReduceFlashing(),
    });
    freezeFrameFlag = activePreference.freezeFrame;
    motionScaleFlag = activePreference.motionScale;
  }
  return activePreference;
}

export function setAccessibilityPreference(
  update: Partial<AccessibilityPreference>,
) {
  const current = getActiveAccessibilityPreference();
  // An explicit in-app change wins over the link for the rest of the visit;
  // fields the visitor did not touch keep their saved value.
  const next = { ...current, ...update };
  const saved = { ...(savedPreference ?? current), ...update };
  savedPreference = saved;
  activePreference = next;
  freezeFrameFlag = next.freezeFrame;
  motionScaleFlag = next.motionScale;
  persistToStorage(saved);
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

/** Read once per frame by the runtime; a flag, not a storage read. */
export function getMotionScale(): number {
  if (!activePreference) {
    getActiveAccessibilityPreference();
  }
  return motionScaleFlag;
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
  motionScaleFlag = 1;
  savedPreference = null;
  subscribers.clear();
}
