export type RenderPreferences = {
  compatibilityMode: boolean;
  maxPixelRatio: number | null;
  renderScale: number | null;
};

type RenderPreferenceSubscriber = (preferences: RenderPreferences) => void;

type RenderPreferenceInput = Partial<RenderPreferences>;

type RenderPreferenceStorage = {
  compatibilityMode?: string | null;
  maxPixelRatio?: string | null;
  renderScale?: string | null;
};

export const COMPATIBILITY_MODE_KEY = 'stims:compatibility-mode';
export const MAX_PIXEL_RATIO_KEY = 'stims:max-pixel-ratio';
export const RENDER_SCALE_KEY = 'stims:render-scale';

const subscribers = new Set<RenderPreferenceSubscriber>();
let activePreferences: RenderPreferences | null = null;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (error) {
    console.debug('localStorage unavailable', error);
    return null;
  }
}

function readNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readFromStorage(): RenderPreferences {
  const storage = getStorage();
  const compatibilityMode = storage?.getItem(COMPATIBILITY_MODE_KEY) === 'true';
  const maxPixelRatio = readNumber(storage?.getItem(MAX_PIXEL_RATIO_KEY));
  const renderScale = readNumber(storage?.getItem(RENDER_SCALE_KEY));

  return {
    compatibilityMode,
    maxPixelRatio,
    renderScale,
  };
}

function persistToStorage(preferences: RenderPreferences) {
  const storage = getStorage();
  if (!storage) return;

  const entries: RenderPreferenceStorage = {
    compatibilityMode: preferences.compatibilityMode ? 'true' : 'false',
    maxPixelRatio:
      typeof preferences.maxPixelRatio === 'number'
        ? String(preferences.maxPixelRatio)
        : null,
    renderScale:
      typeof preferences.renderScale === 'number'
        ? String(preferences.renderScale)
        : null,
  };

  storage.setItem(COMPATIBILITY_MODE_KEY, entries.compatibilityMode ?? 'false');

  const maxPixelRatioValue = entries.maxPixelRatio ?? null;
  if (maxPixelRatioValue === null) {
    storage.removeItem(MAX_PIXEL_RATIO_KEY);
  } else {
    storage.setItem(MAX_PIXEL_RATIO_KEY, maxPixelRatioValue);
  }

  const renderScaleValue = entries.renderScale ?? null;
  if (renderScaleValue === null) {
    storage.removeItem(RENDER_SCALE_KEY);
  } else {
    storage.setItem(RENDER_SCALE_KEY, renderScaleValue);
  }
}

function normalizePreferences(
  input: RenderPreferences,
  options: { clampValues?: boolean } = {},
): RenderPreferences {
  const { clampValues = true } = options;
  const maxPixelRatio =
    typeof input.maxPixelRatio === 'number'
      ? clampValues
        ? clamp(input.maxPixelRatio, 0.75, 3)
        : input.maxPixelRatio
      : null;
  const renderScale =
    typeof input.renderScale === 'number'
      ? clampValues
        ? clamp(input.renderScale, 0.6, 1.4)
        : input.renderScale
      : null;

  return {
    compatibilityMode: Boolean(input.compatibilityMode),
    maxPixelRatio,
    renderScale,
  };
}

export function getActiveRenderPreferences() {
  if (!activePreferences) {
    activePreferences = normalizePreferences(readFromStorage(), {
      clampValues: true,
    });
  }
  return activePreferences;
}

export function setRenderPreferences(update: RenderPreferenceInput) {
  const current = getActiveRenderPreferences();
  const next = normalizePreferences({ ...current, ...update });
  activePreferences = next;
  persistToStorage(next);
  subscribers.forEach((subscriber) => subscriber(next));
  return next;
}

export function clearRenderOverrides() {
  return setRenderPreferences({ maxPixelRatio: null, renderScale: null });
}

export function setCompatibilityMode(enabled: boolean) {
  return setRenderPreferences({ compatibilityMode: enabled });
}

export function isCompatibilityModeEnabled() {
  return getActiveRenderPreferences().compatibilityMode;
}

export function subscribeToRenderPreferences(
  subscriber: RenderPreferenceSubscriber,
) {
  subscribers.add(subscriber);
  if (activePreferences) {
    subscriber(activePreferences);
  }
  return () => {
    subscribers.delete(subscriber);
  };
}

export function resetRenderPreferencesState() {
  activePreferences = null;
  subscribers.clear();
}
