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

const NUMERIC_PREFERENCE_SETTINGS = {
  maxPixelRatio: {
    max: 3,
    min: 0.75,
    storageKey: MAX_PIXEL_RATIO_KEY,
  },
  renderScale: {
    max: 1.4,
    min: 0.6,
    storageKey: RENDER_SCALE_KEY,
  },
} as const;

type NumericPreferenceKey = keyof typeof NUMERIC_PREFERENCE_SETTINGS;

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

function normalizeNumericPreference(
  value: number | null,
  key: NumericPreferenceKey,
  clampValues: boolean,
) {
  if (typeof value !== 'number') {
    return null;
  }

  if (!clampValues) {
    return value;
  }

  const { min, max } = NUMERIC_PREFERENCE_SETTINGS[key];
  return clamp(value, min, max);
}

function setNullableStorageValue(
  storage: Storage,
  key: string,
  value: string | null,
) {
  if (value === null) {
    storage.removeItem(key);
    return;
  }

  storage.setItem(key, value);
}

function readFromStorage(): RenderPreferences {
  const storage = getStorage();
  const compatibilityMode = storage?.getItem(COMPATIBILITY_MODE_KEY) === 'true';

  const numericPreferences = {} as Record<NumericPreferenceKey, number | null>;

  for (const [preferenceName, settings] of Object.entries(
    NUMERIC_PREFERENCE_SETTINGS,
  )) {
    numericPreferences[preferenceName as NumericPreferenceKey] = readNumber(
      storage?.getItem(settings.storageKey),
    );
  }

  return {
    compatibilityMode,
    maxPixelRatio: numericPreferences.maxPixelRatio,
    renderScale: numericPreferences.renderScale,
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

  setNullableStorageValue(
    storage,
    MAX_PIXEL_RATIO_KEY,
    entries.maxPixelRatio ?? null,
  );
  setNullableStorageValue(
    storage,
    RENDER_SCALE_KEY,
    entries.renderScale ?? null,
  );
}

function normalizePreferences(
  input: RenderPreferences,
  options: { clampValues?: boolean } = {},
): RenderPreferences {
  const { clampValues = true } = options;
  const maxPixelRatio = normalizeNumericPreference(
    input.maxPixelRatio,
    'maxPixelRatio',
    clampValues,
  );
  const renderScale = normalizeNumericPreference(
    input.renderScale,
    'renderScale',
    clampValues,
  );

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
