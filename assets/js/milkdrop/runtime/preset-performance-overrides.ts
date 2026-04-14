export type PresetPerformanceQualityPresetId =
  | 'performance'
  | 'low-motion'
  | 'tv'
  | 'balanced'
  | 'hi-fi';

export type PresetPerformanceOverride = {
  qualityPresetId?: PresetPerformanceQualityPresetId;
  disableBlendTransitions?: boolean;
};

const PRESET_PERFORMANCE_OVERRIDES = {
  'parity-legacy-wave-01': {
    qualityPresetId: 'performance',
    disableBlendTransitions: true,
  },
  'parity-legacy-shape-01': {
    qualityPresetId: 'performance',
    disableBlendTransitions: true,
  },
} as const satisfies Record<string, PresetPerformanceOverride>;

export function resolvePresetPerformanceOverride(
  presetId: string,
): PresetPerformanceOverride | null {
  const normalizedPresetId = presetId.trim();
  if (!normalizedPresetId) {
    return null;
  }

  return (
    PRESET_PERFORMANCE_OVERRIDES[
      normalizedPresetId as keyof typeof PRESET_PERFORMANCE_OVERRIDES
    ] ?? null
  );
}
