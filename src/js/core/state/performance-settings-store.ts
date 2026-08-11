import { getPerformanceOverrideParams } from '../url-params.ts';
import { getBrowserStorage } from './browser-storage.ts';
import {
  getActiveQualityPreset,
  subscribeToQualityPreset,
} from './quality-preset-store.ts';

export type ShaderQuality = 'low' | 'balanced' | 'high';

export type PerformanceSettings = {
  maxPixelRatio: number;
  particleBudget: number;
  shaderQuality: ShaderQuality;
};

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  maxPixelRatio: 1.75,
  particleBudget: 1,
  shaderQuality: 'balanced',
};

export const PERFORMANCE_SETTINGS_STORAGE_KEY = 'stims:performance-settings';
export const MIN_PIXEL_RATIO = 1;
// The WebGPU desktop backend cap; applyRendererSettings clamps WebGL lower.
export const MAX_PIXEL_RATIO = 4;
export const MIN_PARTICLE_BUDGET = 0.4;
export const MAX_PARTICLE_BUDGET = 1.6;

type PerformanceSubscriber = (settings: PerformanceSettings) => void;

const subscribers = new Set<PerformanceSubscriber>();
let activeSettings: PerformanceSettings | null = null;
let activeStorageKey = PERFORMANCE_SETTINGS_STORAGE_KEY;
// Whether maxPixelRatio was chosen by the user (slider, URL, or persisted
// value) rather than derived from the active quality preset. A derived value
// keeps following the preset and is never written to storage.
let maxPixelRatioIsUserSet = false;

/**
 * Default resolution cap when the user has not set one: the active quality
 * preset's value. This is what makes selecting "Ultra" actually raise
 * resolution — the store's value is pushed to the renderer as an explicit
 * option, so a fixed default here would permanently override every preset.
 */
function resolveDefaultMaxPixelRatio(): number {
  try {
    const preset = getActiveQualityPreset();
    if (preset.id !== 'custom') {
      return preset.maxPixelRatio;
    }
  } catch {
    // DOM-less environments fall through to the static default.
  }
  return DEFAULT_PERFORMANCE_SETTINGS.maxPixelRatio;
}

subscribeToQualityPreset((preset) => {
  if (
    !activeSettings ||
    maxPixelRatioIsUserSet ||
    preset.id === 'custom' ||
    activeSettings.maxPixelRatio === preset.maxPixelRatio
  ) {
    return;
  }
  activeSettings = {
    ...activeSettings,
    maxPixelRatio: clampPerformanceValue(
      preset.maxPixelRatio,
      MIN_PIXEL_RATIO,
      MAX_PIXEL_RATIO,
    ),
  };
  const next = activeSettings;
  subscribers.forEach((subscriber) => subscriber(next));
});

export function clampPerformanceValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function parseShaderQuality(value: string): ShaderQuality | null {
  if (value === 'low' || value === 'balanced' || value === 'high') {
    return value;
  }
  return null;
}

function parseUrlSettings(): Partial<PerformanceSettings> {
  if (typeof window === 'undefined') {
    return {};
  }
  const params = getPerformanceOverrideParams();
  const parsed: Partial<PerformanceSettings> = {};

  if (params.maxPixelRatio !== null) {
    parsed.maxPixelRatio = clampPerformanceValue(
      params.maxPixelRatio,
      MIN_PIXEL_RATIO,
      MAX_PIXEL_RATIO,
    );
  }

  if (params.particleBudget !== null) {
    parsed.particleBudget = clampPerformanceValue(
      params.particleBudget,
      MIN_PARTICLE_BUDGET,
      MAX_PARTICLE_BUDGET,
    );
  }

  if (
    params.shaderQuality &&
    ['low', 'balanced', 'high'].includes(params.shaderQuality)
  ) {
    parsed.shaderQuality = params.shaderQuality as ShaderQuality;
  }

  return parsed;
}

function getStoredSettings(storageKey = PERFORMANCE_SETTINGS_STORAGE_KEY) {
  const overrides = parseUrlSettings();
  const storage = getBrowserStorage();

  let parsed: Partial<PerformanceSettings> = {};
  const raw = storage?.getItem(storageKey) ?? null;
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Partial<PerformanceSettings>;
    } catch (error) {
      console.debug('Unable to parse stored performance settings', error);
      parsed = {};
    }
  }

  const storedMaxPixelRatio =
    typeof parsed.maxPixelRatio === 'number' &&
    Number.isFinite(parsed.maxPixelRatio)
      ? parsed.maxPixelRatio
      : undefined;
  maxPixelRatioIsUserSet =
    overrides.maxPixelRatio !== undefined || storedMaxPixelRatio !== undefined;

  return {
    ...DEFAULT_PERFORMANCE_SETTINGS,
    ...parsed,
    ...overrides,
    maxPixelRatio: clampPerformanceValue(
      overrides.maxPixelRatio ??
        storedMaxPixelRatio ??
        resolveDefaultMaxPixelRatio(),
      MIN_PIXEL_RATIO,
      MAX_PIXEL_RATIO,
    ),
    particleBudget: clampPerformanceValue(
      overrides.particleBudget ??
        parsed.particleBudget ??
        DEFAULT_PERFORMANCE_SETTINGS.particleBudget,
      MIN_PARTICLE_BUDGET,
      MAX_PARTICLE_BUDGET,
    ),
    shaderQuality:
      overrides.shaderQuality ||
      parseShaderQuality(parsed.shaderQuality ?? '') ||
      DEFAULT_PERFORMANCE_SETTINGS.shaderQuality,
  };
}

function persistSettings(
  settings: PerformanceSettings,
  storageKey = PERFORMANCE_SETTINGS_STORAGE_KEY,
) {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }
  // A preset-derived maxPixelRatio is never persisted: writing it would freeze
  // a derived default into a user choice and stop it tracking preset changes.
  const payload: Partial<PerformanceSettings> = { ...settings };
  if (!maxPixelRatioIsUserSet) {
    delete payload.maxPixelRatio;
  }
  storage.setItem(storageKey, JSON.stringify(payload));
}

export function getActivePerformanceSettings({
  storageKey = PERFORMANCE_SETTINGS_STORAGE_KEY,
}: {
  storageKey?: string;
} = {}): PerformanceSettings {
  if (activeSettings && activeStorageKey === storageKey) {
    // Re-derive a preset-following maxPixelRatio on every read: the push-based
    // subscription above can be severed (test resets clear the quality store's
    // subscriber set), and reads must never return a stale derived value.
    if (!maxPixelRatioIsUserSet) {
      const derived = clampPerformanceValue(
        resolveDefaultMaxPixelRatio(),
        MIN_PIXEL_RATIO,
        MAX_PIXEL_RATIO,
      );
      if (derived !== activeSettings.maxPixelRatio) {
        activeSettings = { ...activeSettings, maxPixelRatio: derived };
      }
    }
    return activeSettings;
  }

  activeSettings = getStoredSettings(storageKey);
  activeStorageKey = storageKey;
  return activeSettings;
}

export function subscribeToPerformanceSettings(
  subscriber: PerformanceSubscriber,
) {
  subscribers.add(subscriber);
  if (activeSettings) {
    subscriber(activeSettings);
  }
  return () => subscribers.delete(subscriber);
}

export function applyPerformanceSettings(
  settings: PerformanceSettings,
  storageKey = PERFORMANCE_SETTINGS_STORAGE_KEY,
) {
  activeSettings = settings;
  activeStorageKey = storageKey;
  subscribers.forEach((subscriber) => subscriber(settings));
  persistSettings(settings, storageKey);
}

export function setPerformanceSettings(
  settings: Partial<PerformanceSettings>,
  { storageKey = activeStorageKey }: { storageKey?: string } = {},
) {
  const current =
    activeSettings ??
    getActivePerformanceSettings({ storageKey: activeStorageKey });
  if (
    typeof settings.maxPixelRatio === 'number' &&
    Number.isFinite(settings.maxPixelRatio)
  ) {
    maxPixelRatioIsUserSet = true;
  }
  const merged: PerformanceSettings = {
    ...current,
    ...settings,
    maxPixelRatio: clampPerformanceValue(
      settings.maxPixelRatio ?? current.maxPixelRatio,
      MIN_PIXEL_RATIO,
      MAX_PIXEL_RATIO,
    ),
    particleBudget: clampPerformanceValue(
      settings.particleBudget ?? current.particleBudget,
      MIN_PARTICLE_BUDGET,
      MAX_PARTICLE_BUDGET,
    ),
    shaderQuality:
      parseShaderQuality(settings.shaderQuality ?? '') ?? current.shaderQuality,
  };
  applyPerformanceSettings(merged, storageKey);
}

export function getActivePerformanceStorageKey() {
  return activeStorageKey;
}

/**
 * Restore defaults, returning maxPixelRatio to preset-following mode instead
 * of freezing the static default as a user choice.
 */
export function resetPerformanceSettingsToDefaults({
  storageKey = activeStorageKey,
}: {
  storageKey?: string;
} = {}): PerformanceSettings {
  maxPixelRatioIsUserSet = false;
  const next: PerformanceSettings = {
    ...DEFAULT_PERFORMANCE_SETTINGS,
    maxPixelRatio: clampPerformanceValue(
      resolveDefaultMaxPixelRatio(),
      MIN_PIXEL_RATIO,
      MAX_PIXEL_RATIO,
    ),
  };
  applyPerformanceSettings(next, storageKey);
  return next;
}

export function setPerformanceOption<K extends keyof PerformanceSettings>(
  key: K,
  value: PerformanceSettings[K],
) {
  setPerformanceSettings({ [key]: value } as Partial<PerformanceSettings>);
}

export function resetPerformanceSettingsStore() {
  activeSettings = null;
  activeStorageKey = PERFORMANCE_SETTINGS_STORAGE_KEY;
  maxPixelRatioIsUserSet = false;
  subscribers.clear();
}
