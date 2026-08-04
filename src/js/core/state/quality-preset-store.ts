import {
  FALLBACK_QUALITY_PRESET_ID,
  getRecommendedQualityPresetId,
} from '../device-profile.ts';
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
    description: 'Half-resolution feedback for thermals, fans, and older GPUs.',
    maxPixelRatio: 1.0,
    renderScale: 0.6,
    particleScale: 0.5,
  },
  {
    id: 'low-motion',
    label: 'Low motion',
    description:
      'Keep the scene crisp while reducing shimmer and particle churn.',
    maxPixelRatio: 1.0,
    renderScale: 0.75,
    particleScale: 0.4,
  },
  {
    id: 'tv',
    label: 'TV balanced',
    description:
      'Comfortable 10-foot visuals with softer density and steadier frame pacing.',
    maxPixelRatio: 1.0,
    renderScale: 0.75,
    particleScale: 0.65,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Default quality target for most laptops and desktops.',
    maxPixelRatio: 1.0,
    renderScale: 0.85,
    particleScale: 1,
  },
  {
    id: 'hi-fi',
    label: 'Hi-fi visuals',
    description: 'Sharper output and denser effects for stronger GPUs.',
    maxPixelRatio: 1.5,
    renderScale: 1,
    particleScale: 1.2,
  },
  {
    id: 'ultra',
    label: 'Ultra visuals',
    description: 'Maximum supersampling and particle density for SOTA GPUs.',
    maxPixelRatio: 2,
    renderScale: 1,
    particleScale: 1.5,
  },
];

export const CUSTOM_QUALITY_PRESET: QualityPreset = {
  id: 'custom',
  label: 'Custom settings',
  description:
    'Individual performance or quality settings have been customized.',
  maxPixelRatio: 1.5,
  renderScale: 1,
  particleScale: 1,
};

export const QUALITY_STORAGE_KEY = 'stims:quality-preset';
const DEFAULT_PRESET_ID = FALLBACK_QUALITY_PRESET_ID;

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

/**
 * Resolution order:
 *   1. the stored preset — an explicit user choice always wins;
 *   2. an explicitly supplied `defaultPresetId` (a caller that already knows
 *      which preset it wants, e.g. re-configuring a panel around the active one);
 *   3. the device-tier recommendation — the first-run default;
 *   4. `balanced`, then the first preset, as last-resort fallbacks.
 *
 * Nothing here writes to storage: resolving a default must stay distinguishable
 * from the user choosing one, otherwise the mapping could never move with the
 * device.
 */
export function getStoredQualityPreset({
  presets = DEFAULT_QUALITY_PRESETS,
  defaultPresetId,
  storageKey = QUALITY_STORAGE_KEY,
}: StoredPresetOptions = {}): QualityPreset {
  const storedId = getStoredPresetId(storageKey);
  const fromStorage = presets.find((preset) => preset.id === storedId);
  if (fromStorage) {
    return fromStorage;
  }

  if (defaultPresetId) {
    const requestedDefault = presets.find(
      (preset) => preset.id === defaultPresetId,
    );
    if (requestedDefault) {
      return requestedDefault;
    }
  }

  const recommendedId = getRecommendedQualityPresetId();
  return (
    presets.find((preset) => preset.id === recommendedId) ||
    presets.find((preset) => preset.id === DEFAULT_PRESET_ID) ||
    presets[0]
  );
}

export function getActiveQualityPreset({
  presets = DEFAULT_QUALITY_PRESETS,
  defaultPresetId,
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

/**
 * Activate a preset for this session without persisting it.
 *
 * Used for the first-run device-tier default: subscribers and the renderer need
 * to see the resolved preset, but writing it to storage would turn a derived
 * default into an explicit user choice and permanently freeze the device
 * mapping for that browser.
 */
export function applyQualityPresetWithoutPersisting(
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

export function markQualityPresetAsCustom({
  storageKey = QUALITY_STORAGE_KEY,
}: {
  storageKey?: string;
} = {}): QualityPreset {
  getBrowserStorage()?.setItem(storageKey, CUSTOM_QUALITY_PRESET.id);
  activeQualityPreset = CUSTOM_QUALITY_PRESET;
  activeQualityPresetStorageKey = storageKey;
  qualitySubscribers.forEach((subscriber) => subscriber(CUSTOM_QUALITY_PRESET));
  return CUSTOM_QUALITY_PRESET;
}

export function resetQualityPresetState() {
  activeQualityPreset = null;
  activeQualityPresetStorageKey = null;
  qualitySubscribers.clear();
}
