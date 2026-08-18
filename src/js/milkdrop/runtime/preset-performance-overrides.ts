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

/**
 * Measured on a Galaxy S22 (Adreno 730, WebGPU 'enhanced' tier) against a
 * production build, 2026-08-18. Method: select each preset, let it run,
 * read averageFrameMs/p95FrameMs/qualityStep from the runtime's own
 * performance tracker (window.__milkdropRuntimeDebug.getPerformance() /
 * getAdaptiveQuality()) — not the rAF-based fps some of the sweep tooling
 * also reports, which reads low and unreliable under CDP measurement
 * overhead and should not be trusted.
 *
 * This is a partial, single-run sample (34 presets; the sweep tab hung
 * partway through a larger run and was not revived — see stims-s22-sweep
 * memory/task notes for the full run this should eventually replace).
 * Entries below are the ones with the strongest signal: averageFrameMs
 * well over the 16.7ms/60Hz budget *and* the adaptive-quality controller
 * already pushed to step 4-5 of 6 and still unable to recover — i.e. this
 * device's own runtime adaptation already tried and failed, so a lower
 * floor is warranted rather than relying on it to keep adapting.
 */
const PRESET_PERFORMANCE_OVERRIDES = {
  // avg 30.0ms, p95 107.8ms at qualityStep 4/6 — the large avg/p95 gap
  // suggests a periodic spike (blend transition cost) on top of an
  // already-expensive preset, not just steady load.
  'martin-the-forge-of-isengard': {
    qualityPresetId: 'performance',
    disableBlendTransitions: true,
  },
  // avg 31.3ms, p95 39.6ms at qualityStep 4/6 — steadily over budget.
  'geiss-color-pox-acid-impression-mix-color-saturation-remix': {
    qualityPresetId: 'performance',
  },
  // avg 25.2ms, p95 30.6ms at qualityStep 5/6 (thermalState: throttling) —
  // the controller's near-maximum degradation still isn't enough.
  'zylot-heaven-bloom-nz': {
    qualityPresetId: 'performance',
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
