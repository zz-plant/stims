import { getBrowserStorage } from './browser-storage.ts';

export type QualityPreset = {
  id: string;
  label: string;
  description?: string;
  maxPixelRatio: number;
  renderScale?: number;
  particleScale?: number;
};

type QualitySubscriber = (preset: QualityPreset) => void;

export const DEFAULT_QUALITY_PRESETS: QualityPreset[] = [
  {
    id: 'performance',
    label: 'Battery saver',
    description: 'Aggressive downshift for thermals, fans, and older GPUs.',
    maxPixelRatio: 1.1,
    renderScale: 0.8,
    particleScale: 0.55,
  },
  {
    id: 'low-motion',
    label: 'Low motion',
    description:
      'Keep the scene crisp while reducing shimmer and particle churn.',
    maxPixelRatio: 1.4,
    renderScale: 1,
    particleScale: 0.4,
  },
  {
    id: 'tv',
    label: 'TV balanced',
    description:
      'Comfortable 10-foot visuals with softer density and steadier frame pacing.',
    maxPixelRatio: 1.1,
    renderScale: 0.85,
    particleScale: 0.7,
  },
  {
    id: 'balanced',
    label: 'Balanced (default)',
    description: 'Default quality target for most laptops and desktops.',
    maxPixelRatio: 1.5,
    renderScale: 1,
    particleScale: 1,
  },
  {
    id: 'hi-fi',
    label: 'Hi-fi visuals',
    description: 'Sharper output and denser effects for stronger GPUs.',
    maxPixelRatio: 1.9,
    renderScale: 1.05,
    particleScale: 1.25,
  },
];

export const QUALITY_STORAGE_KEY = 'stims:quality-preset';
const DEFAULT_PRESET_ID = 'balanced';

let activeQualityPreset: QualityPreset | null = null;
let activeQualityPresetStorageKey: string | null = null;
const qualitySubscribers = new Set<QualitySubscriber>();

function getStoredPresetId(storageKey: string) {
  return getBrowserStorage()?.getItem(storageKey) ?? null;
}

export function hasStoredQualityPreset(storageKey = QUALITY_STORAGE_KEY) {
  return getStoredPresetId(storageKey) !== null;
}

export type StoredPresetOptions = {
  presets?: QualityPreset[];
  defaultPresetId?: string;
  storageKey?: string;
};

export function getStoredQualityPreset({
  presets = DEFAULT_QUALITY_PRESETS,
  defaultPresetId = DEFAULT_PRESET_ID,
  storageKey = QUALITY_STORAGE_KEY,
}: StoredPresetOptions = {}): QualityPreset {
  const storedId = getStoredPresetId(storageKey);
  const fromStorage = presets.find((preset) => preset.id === storedId);
  if (fromStorage) {
    return fromStorage;
  }

  return presets.find((preset) => preset.id === defaultPresetId) || presets[0];
}

export function getActiveQualityPreset({
  presets = DEFAULT_QUALITY_PRESETS,
  defaultPresetId = DEFAULT_PRESET_ID,
  storageKey = QUALITY_STORAGE_KEY,
}: StoredPresetOptions = {}): QualityPreset {
  const storedId = getStoredPresetId(storageKey);

  if (
    activeQualityPreset &&
    activeQualityPresetStorageKey === storageKey &&
    storedId
  ) {
    const activePresetId = activeQualityPreset.id;
    const match = presets.find((preset) => preset.id === activePresetId);
    if (match) {
      return match;
    }
  }

  activeQualityPreset = getStoredQualityPreset({
    presets,
    defaultPresetId,
    storageKey,
  });
  activeQualityPresetStorageKey = storageKey;
  return activeQualityPreset;
}

export function subscribeToQualityPreset(subscriber: QualitySubscriber) {
  qualitySubscribers.add(subscriber);
  if (activeQualityPreset) {
    subscriber(activeQualityPreset);
  }
  return () => {
    qualitySubscribers.delete(subscriber);
  };
}

export type SetQualityPresetOptions = {
  presets?: QualityPreset[];
  storageKey?: string;
};

export function setQualityPresetById(
  presetId: string,
  {
    presets = DEFAULT_QUALITY_PRESETS,
    storageKey = QUALITY_STORAGE_KEY,
  }: SetQualityPresetOptions = {},
): QualityPreset | null {
  const preset = presets.find((entry) => entry.id === presetId);
  if (!preset) {
    return null;
  }

  getBrowserStorage()?.setItem(storageKey, preset.id);
  activeQualityPreset = preset;
  activeQualityPresetStorageKey = storageKey;
  qualitySubscribers.forEach((subscriber) => subscriber(preset));
  return preset;
}

export function getQualityPresetScopeHint(storageKey: string): string {
  if (storageKey === QUALITY_STORAGE_KEY) {
    return 'Saved on this device and shared across Stims sessions.';
  }
  return 'Saved on this device for this visualizer profile.';
}

export function describeQualityPresetImpact(preset: QualityPreset): string {
  const render = preset.renderScale ?? 1;
  const particles = preset.particleScale ?? 1;
  return `What changes: pixel ratio up to ${preset.maxPixelRatio.toFixed(2)}x, render scale ${render.toFixed(2)}x, particle density ${particles.toFixed(2)}x.`;
}

export function resetQualityPresetState() {
  activeQualityPreset = null;
  activeQualityPresetStorageKey = null;
  qualitySubscribers.clear();
}
