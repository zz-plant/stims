import {
  isInAppBrowser,
  isMobileDevice,
  isSmartTvDevice,
} from '../../utils/browser/device-detect.ts';
import { getDisplayRefreshRate } from '../device-profile.ts';
import type {
  RendererBackend,
  WebGPUCapabilitySummary,
} from '../renderer-capabilities.ts';

export type AdaptiveQualityTimingMode = 'coarse-frame' | 'gpu-phase-timestamps';

export type AdaptiveQualityPhaseTimings = Partial<{
  simulationMs: number;
  renderMs: number;
  postprocessMs: number;
  presentMs: number;
}>;

export type AdaptiveQualitySample = {
  frameMs: number;
  cadenceMs?: number;
  gpuMs?: number;
  phases?: AdaptiveQualityPhaseTimings;
};

export type AdaptiveQualityMultipliers = {
  renderScaleMultiplier: number;
  maxPixelRatioMultiplier: number;
  densityMultiplier: number;
  feedbackResolutionMultiplier: number;
};

export type AdaptiveQualityState = AdaptiveQualityMultipliers & {
  enabled: boolean;
  backend: RendererBackend;
  timingMode: AdaptiveQualityTimingMode;
  supportsGpuTimestamps: boolean;
  profile: string;
  frameBudgetMs: number;
  qualityStep: number;
  qualityStepCount: number;
  averageFrameMs: number | null;
  averageCadenceMs: number | null;
  averageRenderMs: number | null;
  averageGpuMs: number | null;
  sampleCount: number;
  jankCount: number;
  frameVarianceMs2: number | null;
  thermalState: 'nominal' | 'elevated' | 'throttling';
  rollingAverageFrameMs: number | null;
  rollingWindowSize: number;
  adaptation: 'steady' | 'degraded' | 'recovering' | 'enhanced';
  reasons: string[];
};

export type AdaptiveQualityController = {
  getState: () => AdaptiveQualityState;
  recordFrame: (sample: AdaptiveQualitySample) => AdaptiveQualityState;
  setQualityStep: (step: number) => AdaptiveQualityState;
  subscribe: (subscriber: (state: AdaptiveQualityState) => void) => () => void;
};

type AdaptiveQualityControllerOptions = {
  backend: RendererBackend;
  capabilities: WebGPUCapabilitySummary | null;
  /**
   * When set, the controller keeps measuring frame timings but never changes
   * quality step. Performance runs use this so a frame-time delta reflects the
   * change under test instead of the controller re-balancing quality.
   */
  lockedQualityStep?: number | null;
};

type QualityStep = AdaptiveQualityMultipliers & {
  id: string;
};

const QUALITY_STEPS: readonly QualityStep[] = [
  {
    id: 'ultra',
    renderScaleMultiplier: 1.25,
    maxPixelRatioMultiplier: 1.25,
    densityMultiplier: 1.35,
    feedbackResolutionMultiplier: 1.25,
  },
  {
    id: 'full',
    renderScaleMultiplier: 1,
    maxPixelRatioMultiplier: 1,
    densityMultiplier: 1,
    feedbackResolutionMultiplier: 1,
  },
  {
    id: 'balanced',
    renderScaleMultiplier: 0.94,
    maxPixelRatioMultiplier: 0.96,
    densityMultiplier: 0.92,
    feedbackResolutionMultiplier: 0.9,
  },
  {
    id: 'reduced',
    renderScaleMultiplier: 0.88,
    maxPixelRatioMultiplier: 0.92,
    densityMultiplier: 0.82,
    feedbackResolutionMultiplier: 0.8,
  },
  {
    id: 'low',
    renderScaleMultiplier: 0.8,
    maxPixelRatioMultiplier: 0.86,
    densityMultiplier: 0.72,
    feedbackResolutionMultiplier: 0.68,
  },
  {
    id: 'minimal',
    renderScaleMultiplier: 0.72,
    maxPixelRatioMultiplier: 0.8,
    densityMultiplier: 0.6,
    feedbackResolutionMultiplier: 0.56,
  },
] as const;

const EMA_ALPHA = 0.18;
const MIN_WARMUP_SAMPLES = 12;
const DEGRADE_THRESHOLD_SAMPLES = 6;
const RECOVER_THRESHOLD_SAMPLES = 30;
const ENHANCE_THRESHOLD_SAMPLES = 60;
const RESET_THRESHOLD_SAMPLES = 3;
const ROLLING_WINDOW_DEGRADE_THRESHOLD_SAMPLES = 3;
const ROLLING_WINDOW_MS = 5000;
/**
 * Cadence that still counts as "presenting on target" when looking for
 * headroom. This must be >= 1: a session presenting perfectly at vsync has
 * `cadenceMs === frameBudgetMs`, so requiring cadence to be *faster* than
 * the budget (the old `* 0.9`) made headroom unreachable on exactly the
 * displays most people use — 16.67ms measured against a 15.0ms bar on
 * 60Hz, 8.33 against 7.5 on 120Hz. Quality could then only ever ratchet
 * down, and one transient spike stranded the session at reduced quality
 * for good. The degrade side treats > 1.08 as pressure, so 1.05 leaves a
 * small dead band between "recovering" and "degrading".
 */
const CADENCE_AT_TARGET_RATIO = 1.05;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function updateEma(previous: number | null, next: number) {
  if (!Number.isFinite(next)) {
    return previous;
  }
  if (previous === null) {
    return next;
  }
  return previous + (next - previous) * EMA_ALPHA;
}

export function getAdaptiveQualityDisplayRefreshRate(): number {
  return getDisplayRefreshRate();
}

function estimateFrameBudgetMs(): number {
  // Mobile displays (especially high-refresh 120Hz/144Hz panels) target 60Hz
  // (16.67ms) to preserve battery life and prevent rapid thermal throttling.
  if (isMobileDevice()) {
    return 1000 / 60;
  }

  // Budget against at most a 120Hz cadence: a 144-240Hz panel that presents at
  // panel rate would otherwise get a 4-7ms budget, read every frame as
  // over-budget, and pin the controller into permanent degradation.
  const hz = Math.min(getAdaptiveQualityDisplayRefreshRate(), 120);
  return 1000 / hz;
}

function buildHeuristicProfile(
  backend: RendererBackend,
  capabilities: WebGPUCapabilitySummary | null,
) {
  const frameBudgetMs = estimateFrameBudgetMs();

  if (backend === 'webgl') {
    const isDesktopHighEnd =
      !isMobileDevice() &&
      !isSmartTvDevice() &&
      (typeof navigator === 'undefined' ||
        (navigator.hardwareConcurrency ?? 0) >= 6);
    const reasons = [
      isDesktopHighEnd
        ? 'Desktop WebGL sessions start from full quality with coarse frame monitoring.'
        : 'WebGL fallback sessions start from a conservative adaptive quality step.',
      'Coarse CPU frame timing is used because GPU timing is unavailable.',
    ];
    let initialStep = isDesktopHighEnd ? 1 : 2;
    if (isSmartTvDevice()) {
      reasons.push(
        'Smart TV hardware operates from a conservative initial quality step.',
      );
      initialStep = Math.max(initialStep, 3);
    }
    return {
      frameBudgetMs,
      initialStep,
      profile: 'fallback-webgl',
      reasons,
    };
  }

  if (!capabilities) {
    return {
      frameBudgetMs,
      initialStep: 3,
      profile: 'fallback-webgpu',
      reasons: ['No WebGPU capability snapshot was available for adaptation.'],
    };
  }

  const reasons: string[] = [];
  let initialStep =
    capabilities.performanceTier === 'high-end'
      ? 0
      : capabilities.performanceTier === 'enhanced'
        ? 1
        : 2;

  if (isSmartTvDevice()) {
    reasons.push(
      'Smart TV hardware operates from a conservative initial quality step.',
    );
    initialStep = Math.max(initialStep, 2);
  }

  // 'ultra' and 'hi-fi' are both top-tier recommendations; production code
  // emits 'ultra' for high-end desktops, so treating only 'hi-fi' as top-tier
  // silently demoted every real high-end machine one step.
  const topTierRecommendation =
    capabilities.recommendedQualityPreset === 'ultra' ||
    capabilities.recommendedQualityPreset === 'hi-fi';
  if (!topTierRecommendation) {
    initialStep = Math.max(initialStep, 1);
  }

  if (!capabilities.features.float32Blendable) {
    reasons.push('float32 blendable attachments are unavailable.');
    initialStep += 1;
  }
  if (
    !capabilities.features.float32Filterable &&
    !capabilities.features.shaderF16
  ) {
    reasons.push('float32 filterable textures are unavailable.');
    initialStep += 1;
  }
  if (!capabilities.features.shaderF16) {
    reasons.push('shader-f16 is unavailable.');
    initialStep += 1;
  }
  if ((capabilities.limits.maxTextureDimension2D ?? 0) < 8_192) {
    reasons.push('2D texture limits are below the high-end target.');
    initialStep += 1;
  }
  if ((capabilities.limits.maxColorAttachments ?? 0) < 8) {
    reasons.push('color-attachment headroom is limited.');
    initialStep += 1;
  }
  if (capabilities.performanceTier === 'high-end' && !topTierRecommendation) {
    reasons.push(
      'Balanced startup quality is preferred on touch-first devices for steadier frame pacing.',
    );
  }

  if (isMobileDevice()) {
    const isFlagshipMobile =
      capabilities.performanceTier === 'high-end' &&
      typeof navigator !== 'undefined' &&
      (navigator.hardwareConcurrency ?? 0) >= 6;
    const mobileFloor = isFlagshipMobile ? 0 : 2;
    initialStep = Math.max(initialStep, mobileFloor);
    reasons.push(
      isFlagshipMobile
        ? 'Flagship mobile sessions start from full quality with adaptive throttling headroom.'
        : 'Touch-first mobile sessions start from balanced quality for steadier sustained performance.',
    );
  } else if (isInAppBrowser()) {
    initialStep = Math.max(initialStep, 2);
    reasons.push(
      'In-app webview sessions start from balanced quality for steadier sustained performance.',
    );
  }

  initialStep = clamp(initialStep, 0, QUALITY_STEPS.length - 1);

  return {
    frameBudgetMs,
    initialStep,
    profile: capabilities.performanceTier,
    reasons,
  };
}

function buildState({
  backend,
  timingMode,
  supportsGpuTimestamps,
  profile,
  frameBudgetMs,
  qualityStep,
  averageFrameMs,
  averageCadenceMs,
  averageRenderMs,
  averageGpuMs,
  jankCount,
  frameVarianceMs2,
  thermalState,
  rollingAverageFrameMs,
  rollingWindowSize,
  sampleCount,
  adaptation,
  reasons,
}: {
  backend: RendererBackend;
  timingMode: AdaptiveQualityTimingMode;
  supportsGpuTimestamps: boolean;
  profile: string;
  frameBudgetMs: number;
  qualityStep: number;
  averageFrameMs: number | null;
  averageCadenceMs: number | null;
  averageRenderMs: number | null;
  averageGpuMs: number | null;
  jankCount: number;
  frameVarianceMs2: number | null;
  thermalState: 'nominal' | 'elevated' | 'throttling';
  rollingAverageFrameMs: number | null;
  rollingWindowSize: number;
  sampleCount: number;
  adaptation: AdaptiveQualityState['adaptation'];
  reasons: string[];
}) {
  const step = QUALITY_STEPS[qualityStep] as QualityStep;
  return {
    enabled: true,
    backend,
    timingMode,
    supportsGpuTimestamps,
    profile,
    frameBudgetMs,
    qualityStep,
    qualityStepCount: QUALITY_STEPS.length,
    averageFrameMs,
    averageCadenceMs,
    averageRenderMs,
    averageGpuMs,
    sampleCount,
    jankCount,
    frameVarianceMs2,
    thermalState,
    rollingAverageFrameMs,
    rollingWindowSize,
    adaptation,
    reasons,
    renderScaleMultiplier: step.renderScaleMultiplier,
    maxPixelRatioMultiplier: step.maxPixelRatioMultiplier,
    densityMultiplier: step.densityMultiplier,
    feedbackResolutionMultiplier: step.feedbackResolutionMultiplier,
  } satisfies AdaptiveQualityState;
}

let activeAdaptiveQualityController: AdaptiveQualityController | null = null;

export function getActiveAdaptiveQualityController(): AdaptiveQualityController | null {
  return activeAdaptiveQualityController;
}

export function createAdaptiveQualityController({
  backend,
  capabilities,
  lockedQualityStep = null,
}: AdaptiveQualityControllerOptions): AdaptiveQualityController {
  const subscribers = new Set<(state: AdaptiveQualityState) => void>();
  const supportsGpuTimestamps =
    backend === 'webgpu' && Boolean(capabilities?.features.timestampQuery);
  const timingMode: AdaptiveQualityTimingMode = supportsGpuTimestamps
    ? 'gpu-phase-timestamps'
    : 'coarse-frame';
  const heuristic = buildHeuristicProfile(backend, capabilities);

  const stepLock =
    typeof lockedQualityStep === 'number' && Number.isFinite(lockedQualityStep)
      ? Math.min(
          Math.max(Math.round(lockedQualityStep), 0),
          QUALITY_STEPS.length - 1,
        )
      : null;
  let qualityStep = stepLock ?? heuristic.initialStep;
  let averageFrameMs: number | null = null;
  let averageCadenceMs: number | null = null;
  let averageRenderMs: number | null = null;
  let averageGpuMs: number | null = null;
  let rollingAverageFrameMs: number | null = null;
  let sampleCount = 0;
  let consecutiveOverBudget = 0;
  let consecutiveUnderBudget = 0;
  let consecutiveRollingOverBudget = 0;
  let adaptation: AdaptiveQualityState['adaptation'] = 'steady';
  const rollingWindowSize = Math.max(
    30,
    Math.ceil(ROLLING_WINDOW_MS / heuristic.frameBudgetMs),
  );
  const rollingFrameTimes = new Float64Array(rollingWindowSize);
  let rollingFrameTimesSum = 0;
  let rollingFrameTimesIndex = 0;
  let rollingFrameTimesFilled = false;

  /**
   * Drops the pre-change evidence a quality change invalidates. The ~5s
   * rolling window is the one that matters: without this it still holds
   * frames rendered at the *old* step, so `rollingFramePressure` stays true
   * and re-degrades three samples later purely because the average hasn't
   * caught up yet — not because the new step is actually too slow. After
   * the reset, a re-degrade only fires on frames measured *after* the
   * change, which is a real signal even at a small sample count, not a
   * stale one. Deliberately fast: sustained genuine pressure should still
   * walk down multiple steps in quick succession.
   *
   * The EMAs are left alone. `consecutiveOverBudget`/`consecutiveUnderBudget`
   * are reset by each branch already, and nulling the EMAs would blank
   * `averageFrameMs`/`averageRenderMs` in the published state that the perf
   * HUD and telemetry read.
   *
   * `rollingAverageFrameMs` is also left as-is here rather than nulled: the
   * sum/count bookkeeping below only ever covers samples at or after
   * `rollingFrameTimesIndex`, so the stale array contents this clears are
   * already excluded from the next average regardless. Nulling it here would
   * only wipe the number that just justified this decision — this function
   * runs before the degrade branch builds its "rolling average exceeded
   * budget" reason string, so that message would report `undefined`. The
   * next recorded frame naturally overwrites it with a fresh, small-sample
   * average.
   */
  let rollingFrameTimesSqSum = 0;

  function resetRollingWindowAfterStepChange() {
    rollingFrameTimes.fill(0);
    rollingFrameTimesSum = 0;
    rollingFrameTimesSqSum = 0;
    rollingFrameTimesIndex = 0;
    rollingFrameTimesFilled = false;
    consecutiveRollingOverBudget = 0;
  }

  function pushRollingFrameTime(frameMs: number) {
    if (rollingFrameTimesFilled) {
      const oldVal = rollingFrameTimes[rollingFrameTimesIndex] ?? 0;
      rollingFrameTimesSum -= oldVal;
      rollingFrameTimesSqSum -= oldVal * oldVal;
    }
    rollingFrameTimes[rollingFrameTimesIndex] = frameMs;
    rollingFrameTimesSum += frameMs;
    rollingFrameTimesSqSum += frameMs * frameMs;
    rollingFrameTimesIndex = (rollingFrameTimesIndex + 1) % rollingWindowSize;
    if (rollingFrameTimesIndex === 0) {
      rollingFrameTimesFilled = true;
    }
    const count = rollingFrameTimesFilled
      ? rollingWindowSize
      : rollingFrameTimesIndex;
    rollingAverageFrameMs = count > 0 ? rollingFrameTimesSum / count : null;
  }

  let jankCount = 0;
  let frameVarianceMs2: number | null = null;
  let thermalState: 'nominal' | 'elevated' | 'throttling' = 'nominal';

  function computeFrameVariance(): number | null {
    const count = rollingFrameTimesFilled
      ? rollingWindowSize
      : rollingFrameTimesIndex;
    if (count < 2 || rollingAverageFrameMs === null) return null;
    const meanSq = rollingFrameTimesSqSum / count;
    const varVal = meanSq - rollingAverageFrameMs * rollingAverageFrameMs;
    return varVal < 0 ? 0 : varVal;
  }

  function updateThermalState() {
    const varMs2 = computeFrameVariance();
    frameVarianceMs2 = varMs2;
    const sqBudget = heuristic.frameBudgetMs * heuristic.frameBudgetMs;
    if (
      consecutiveOverBudget >= 5 ||
      (varMs2 !== null && varMs2 > sqBudget * 0.4)
    ) {
      thermalState = 'throttling';
    } else if (
      consecutiveOverBudget >= 2 ||
      (varMs2 !== null && varMs2 > sqBudget * 0.15)
    ) {
      thermalState = 'elevated';
    } else {
      thermalState = 'nominal';
    }
  }

  let state = buildState({
    backend,
    timingMode,
    supportsGpuTimestamps,
    profile: heuristic.profile,
    frameBudgetMs: heuristic.frameBudgetMs,
    qualityStep,
    averageFrameMs,
    averageCadenceMs,
    averageRenderMs,
    averageGpuMs,
    sampleCount,
    jankCount,
    frameVarianceMs2,
    thermalState,
    rollingAverageFrameMs,
    rollingWindowSize,
    adaptation,
    reasons: [
      ...heuristic.reasons,
      ...(backend === 'webgpu'
        ? [
            supportsGpuTimestamps
              ? 'timestamp-query durations are used when the renderer supplies them.'
              : 'Falling back to coarse CPU frame timing for now.',
          ]
        : []),
    ],
  });

  const publish = () => {
    updateThermalState();
    state = buildState({
      backend,
      timingMode,
      supportsGpuTimestamps,
      profile: heuristic.profile,
      frameBudgetMs: heuristic.frameBudgetMs,
      qualityStep,
      averageFrameMs,
      averageCadenceMs,
      averageRenderMs,
      averageGpuMs,
      sampleCount,
      jankCount,
      frameVarianceMs2,
      thermalState,
      rollingAverageFrameMs,
      rollingWindowSize,
      adaptation,
      reasons: state.reasons,
    });
    subscribers.forEach((subscriber) => subscriber(state));
    return state;
  };

  const controller: AdaptiveQualityController = {
    getState: () => state,
    setQualityStep: (step: number) => {
      const targetStep = Math.min(
        Math.max(Math.round(step), 0),
        QUALITY_STEPS.length - 1,
      );
      qualityStep = targetStep;
      adaptation = 'steady';
      consecutiveOverBudget = 0;
      consecutiveUnderBudget = 0;
      resetRollingWindowAfterStepChange();
      state = {
        ...state,
        reasons: [
          ...heuristic.reasons,
          `Quality step manually set to ${QUALITY_STEPS[targetStep].id}.`,
        ],
      };
      return publish();
    },
    recordFrame: ({
      frameMs,
      cadenceMs,
      gpuMs,
      phases,
    }: AdaptiveQualitySample) => {
      if (!Number.isFinite(frameMs)) {
        return state;
      }

      sampleCount += 1;
      if (frameMs > heuristic.frameBudgetMs * 1.5) {
        jankCount += 1;
      }
      averageFrameMs = updateEma(averageFrameMs, frameMs);
      pushRollingFrameTime(frameMs);
      if (
        typeof cadenceMs === 'number' &&
        Number.isFinite(cadenceMs) &&
        cadenceMs > 0
      ) {
        averageCadenceMs = updateEma(averageCadenceMs, cadenceMs);
      }
      const renderMs = phases?.renderMs;
      if (typeof renderMs === 'number' && Number.isFinite(renderMs)) {
        averageRenderMs = updateEma(averageRenderMs, renderMs);
      }
      if (
        supportsGpuTimestamps &&
        typeof gpuMs === 'number' &&
        Number.isFinite(gpuMs) &&
        gpuMs >= 0
      ) {
        averageGpuMs = updateEma(averageGpuMs, gpuMs);
      }

      if (sampleCount < MIN_WARMUP_SAMPLES) {
        // During warmup, only publish every 4th sample to reduce GC pressure
        if (sampleCount % 4 === 0 || sampleCount === 1) {
          return publish();
        }
        return state;
      }

      const renderPressure =
        averageRenderMs !== null &&
        averageRenderMs > heuristic.frameBudgetMs * 0.82;
      const gpuPressure =
        averageGpuMs !== null && averageGpuMs > heuristic.frameBudgetMs * 0.82;
      const framePressure =
        averageFrameMs !== null &&
        averageFrameMs > heuristic.frameBudgetMs * 1.08;
      const cadencePressure =
        averageCadenceMs !== null &&
        averageCadenceMs > heuristic.frameBudgetMs * 1.12 &&
        (averageFrameMs === null ||
          averageFrameMs > heuristic.frameBudgetMs * 0.85);
      const hasHeadroom =
        averageFrameMs !== null &&
        averageFrameMs < heuristic.frameBudgetMs * 0.72 &&
        (averageCadenceMs === null ||
          averageCadenceMs <=
            heuristic.frameBudgetMs * CADENCE_AT_TARGET_RATIO) &&
        (averageRenderMs === null ||
          averageRenderMs < heuristic.frameBudgetMs * 0.55) &&
        (averageGpuMs === null ||
          averageGpuMs < heuristic.frameBudgetMs * 0.55);
      const rollingFramePressure =
        rollingAverageFrameMs !== null &&
        rollingAverageFrameMs > heuristic.frameBudgetMs;
      if (rollingFramePressure) {
        consecutiveRollingOverBudget += 1;
      } else {
        consecutiveRollingOverBudget = 0;
      }

      if (renderPressure || gpuPressure || framePressure || cadencePressure) {
        consecutiveOverBudget += 1;
        consecutiveUnderBudget = 0;
      } else if (hasHeadroom) {
        consecutiveUnderBudget += 1;
        consecutiveOverBudget = 0;
      } else {
        consecutiveOverBudget = Math.max(0, consecutiveOverBudget - 1);
        consecutiveUnderBudget = Math.max(0, consecutiveUnderBudget - 1);
      }

      const triggeredByRollingWindow =
        consecutiveRollingOverBudget >=
        ROLLING_WINDOW_DEGRADE_THRESHOLD_SAMPLES;
      if (
        stepLock === null &&
        (consecutiveOverBudget >= DEGRADE_THRESHOLD_SAMPLES ||
          triggeredByRollingWindow) &&
        qualityStep < QUALITY_STEPS.length - 1
      ) {
        qualityStep += 1;
        adaptation = 'degraded';
        consecutiveOverBudget = 0;
        consecutiveUnderBudget = 0;
        resetRollingWindowAfterStepChange();
        state = {
          ...state,
          reasons: [
            ...heuristic.reasons,
            triggeredByRollingWindow
              ? `5-second rolling frame-time average (${rollingAverageFrameMs?.toFixed(1)}ms) exceeded the ${heuristic.frameBudgetMs.toFixed(1)}ms budget.`
              : gpuPressure
                ? 'GPU timing pushed the controller below the baseline budget.'
                : cadencePressure
                  ? 'Presentation cadence pushed the controller below the baseline budget.'
                  : 'CPU frame timing pushed the controller below the baseline budget.',
          ],
        };
        return publish();
      }

      if (
        stepLock === null &&
        consecutiveUnderBudget >= RECOVER_THRESHOLD_SAMPLES &&
        qualityStep > heuristic.initialStep
      ) {
        qualityStep -= 1;
        adaptation = 'recovering';
        consecutiveOverBudget = 0;
        consecutiveUnderBudget = 0;
        resetRollingWindowAfterStepChange();
        state = {
          ...state,
          reasons: [
            ...heuristic.reasons,
            'Frame headroom allowed the controller to restore quality.',
          ],
        };
        return publish();
      }

      if (
        stepLock === null &&
        consecutiveUnderBudget >= ENHANCE_THRESHOLD_SAMPLES &&
        qualityStep > 0 &&
        (heuristic.profile === 'high-end' || heuristic.profile === 'enhanced')
      ) {
        qualityStep -= 1;
        adaptation = 'enhanced';
        consecutiveOverBudget = 0;
        consecutiveUnderBudget = 0;
        resetRollingWindowAfterStepChange();
        state = {
          ...state,
          reasons: [
            ...heuristic.reasons,
            `Sustained headroom — stepping up to ${QUALITY_STEPS[qualityStep].id}.`,
          ],
        };
        return publish();
      }

      if (
        adaptation !== 'steady' &&
        consecutiveOverBudget < RESET_THRESHOLD_SAMPLES &&
        consecutiveUnderBudget < RESET_THRESHOLD_SAMPLES
      ) {
        adaptation = 'steady';
      }

      return state;
    },
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      subscriber(state);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };
  activeAdaptiveQualityController = controller;
  return controller;
}
