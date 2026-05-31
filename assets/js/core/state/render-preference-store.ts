import { clearWebGPUCompatibilityGapOverride } from '../renderer-query-override.ts';
import { getBrowserStorage } from './browser-storage.ts';

export type RenderPreferences = {
  compatibilityMode: boolean;
};

export const COMPATIBILITY_MODE_KEY = 'stims:compatibility-mode';

type RenderPreferenceSubscriber = (preferences: RenderPreferences) => void;
type RenderPreferenceInput = Partial<RenderPreferences>;

const subscribers = new Set<RenderPreferenceSubscriber>();
let activePreferences: RenderPreferences | null = null;

function readFromStorage(): RenderPreferences {
  const storage = getBrowserStorage();
  const compatibilityMode = storage?.getItem(COMPATIBILITY_MODE_KEY) === 'true';

  return { compatibilityMode };
}

function persistToStorage(preferences: RenderPreferences) {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }

  storage.setItem(
    COMPATIBILITY_MODE_KEY,
    preferences.compatibilityMode ? 'true' : 'false',
  );
}

function normalizePreferences(input: RenderPreferences): RenderPreferences {
  return {
    compatibilityMode: Boolean(input.compatibilityMode),
  };
}

export function getActiveRenderPreferences() {
  if (!activePreferences) {
    activePreferences = normalizePreferences(readFromStorage());
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
  return setRenderPreferences({});
}

export function setCompatibilityMode(enabled: boolean) {
  if (enabled) {
    clearWebGPUCompatibilityGapOverride();
  }
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

export function resetRenderPreferenceStore() {
  activePreferences = null;
  subscribers.clear();
}
