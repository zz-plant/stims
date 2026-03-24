import { getBrowserStorage } from './browser-storage.ts';

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
export const MAX_PIXEL_RATIO = 2.5;
export const MIN_PARTICLE_BUDGET = 0.4;
export const MAX_PARTICLE_BUDGET = 1.6;

type PerformanceSubscriber = (settings: PerformanceSettings) => void;

const subscribers = new Set<PerformanceSubscriber>();
let activeSettings: PerformanceSettings | null = null;
let activeStorageKey = PERFORMANCE_SETTINGS_STORAGE_KEY;

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
  const params = new URLSearchParams(window.location.search);

  const urlMaxPixelRatio = params.get('maxPixelRatio');
  const urlParticleBudget = params.get('particleBudget');
  const urlShaderQuality = params.get('shaderQuality');
  const parsed: Partial<PerformanceSettings> = {};

  if (urlMaxPixelRatio) {
    const value = Number.parseFloat(urlMaxPixelRatio);
    if (!Number.isNaN(value)) {
      parsed.maxPixelRatio = clampPerformanceValue(
        value,
        MIN_PIXEL_RATIO,
        MAX_PIXEL_RATIO,
      );
    }
  }

  if (urlParticleBudget) {
    const value = Number.parseFloat(urlParticleBudget);
    if (!Number.isNaN(value)) {
      parsed.particleBudget = clampPerformanceValue(
        value,
        MIN_PARTICLE_BUDGET,
        MAX_PARTICLE_BUDGET,
      );
    }
  }

  if (urlShaderQuality) {
    const quality = parseShaderQuality(urlShaderQuality);
    if (quality) {
      parsed.shaderQuality = quality;
    }
  }

  return parsed;
}

function getStoredSettings(storageKey = PERFORMANCE_SETTINGS_STORAGE_KEY) {
  const overrides = parseUrlSettings();
  const storage = getBrowserStorage();

  if (!storage) {
    return { ...DEFAULT_PERFORMANCE_SETTINGS, ...overrides };
  }

  const raw = storage.getItem(storageKey);
  if (!raw) {
    return { ...DEFAULT_PERFORMANCE_SETTINGS, ...overrides };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PerformanceSettings>;
    return {
      ...DEFAULT_PERFORMANCE_SETTINGS,
      ...parsed,
      ...overrides,
      maxPixelRatio: clampPerformanceValue(
        parsed.maxPixelRatio ??
          overrides.maxPixelRatio ??
          DEFAULT_PERFORMANCE_SETTINGS.maxPixelRatio,
        MIN_PIXEL_RATIO,
        MAX_PIXEL_RATIO,
      ),
      particleBudget: clampPerformanceValue(
        parsed.particleBudget ??
          overrides.particleBudget ??
          DEFAULT_PERFORMANCE_SETTINGS.particleBudget,
        MIN_PARTICLE_BUDGET,
        MAX_PARTICLE_BUDGET,
      ),
      shaderQuality:
        parseShaderQuality(parsed.shaderQuality ?? '') ||
        overrides.shaderQuality ||
        DEFAULT_PERFORMANCE_SETTINGS.shaderQuality,
    };
  } catch (error) {
    console.debug('Unable to parse stored performance settings', error);
    return { ...DEFAULT_PERFORMANCE_SETTINGS, ...overrides };
  }
}

function persistSettings(
  settings: PerformanceSettings,
  storageKey = PERFORMANCE_SETTINGS_STORAGE_KEY,
) {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }
  storage.setItem(storageKey, JSON.stringify(settings));
}

export function getActivePerformanceSettings({
  storageKey = PERFORMANCE_SETTINGS_STORAGE_KEY,
}: {
  storageKey?: string;
} = {}): PerformanceSettings {
  if (activeSettings && activeStorageKey === storageKey) {
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

export function resetPerformanceSettingsStore() {
  activeSettings = null;
  activeStorageKey = PERFORMANCE_SETTINGS_STORAGE_KEY;
  subscribers.clear();
}
