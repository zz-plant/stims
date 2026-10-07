/**
 * flash-guard: WCAG 2.3.1 flash analysis for frame sequences, and a live
 * governor that keeps a canvas under the threshold while it is being shown.
 *
 * Offline: `analyzeRgbaFrames` (pixels) or `analyzeFlashTimeline`
 * (luminance grids) -> `FlashAnalysis` -> `classifyFlashRisk`.
 * Live: `createFlashController({ canvas, applyLuminanceScale })`, or drive
 * `createFlashGovernor()` yourself with one luminance grid per frame.
 */
export {
  analyzeFlashEvents,
  analyzeFlashTimeline,
  type FlashAnalysis,
  type FlashAnalysisInput,
  type FlashCountInput,
} from './analysis.ts';
export {
  createBrightnessFilterApplier,
  createFlashController,
  type FlashController,
  type FlashControllerOptions,
  type FrameListener,
  MIN_SAMPLE_INTERVAL_MS,
} from './controller.ts';
export {
  analyzeRgbaFrames,
  createFlashFrameCounter,
  type FlashFrameCounter,
  type FlashFrameCounterOptions,
  type RgbaFrame,
} from './frames.ts';
export {
  createFlashGovernor,
  type FlashGovernor,
  type FlashGovernorDecision,
  type FlashGovernorOptions,
  type FlashSampleOptions,
  MIN_USEFUL_GRID,
  primingHoldForMeasurement,
  RECOMMENDED_GRID,
  RECOMMENDED_SAMPLE_DENSITY,
} from './governor.ts';
export {
  classifyFlashRisk,
  describeFlashRisk,
  type FlashMeasurement,
  type FlashRiskLevel,
} from './risk.ts';
export {
  createFlashSampler,
  createMainThreadFlashReader,
  type FlashGridCallback,
  type FlashSampler,
  type FlashSamplerOptions,
  MAX_CAPTURES_IN_FLIGHT,
} from './sampler.ts';
export * from './thresholds.ts';
