import {
  getDisplayRefreshRate,
  getHardwareSignals,
} from '../device-profile.ts';
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
  /** Continuous GPU-only resolution trim within the discrete quality step. */
  gpuResolutionMultiplier: number;
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
  /**
   * Freezes (or releases) the quality step at whatever it is right now.
   * Unlike `lockedQualityStep`, which pins a configured step from
   * construction, this holds the level the controller has already settled
   * on — see live-performance-mode.ts.
   */
  setStepLocked: (locked: boolean) => AdaptiveQualityState;
  recordFrame: (sample: AdaptiveQualitySample) => AdaptiveQualityState;
  setQualityStep: (step: number) => AdaptiveQualityState;
  /**
   * Tells the controller a preset was just applied. Clears in-flight
   * pressure evidence (the compile + feedback warm-up spike resolves on its
   * own, and letting it demote the step forces a needless degrade→recover
   * round trip), and on constrained profiles pre-degrades one step so the
   * warm-up renders at reduced resolution instead of dropping frames first —
   * the existing headroom-recovery path walks it back up.
   */
  notePresetApplied: () => AdaptiveQualityState;
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
  /**
   * Pin the resolution multipliers to 1 while leaving the step's mesh/wave
   * density alone.
   *
   * Parity captures need this. The `ultra` step supersamples at 1.25x and the
   * screenshot then downsamples to the capture size, where projectM renders at
   * native resolution and does not — so every captured frame was softer than
   * the reference it is diffed against. Measured on the deterministic pair:
   * 260-compshader-noise_lq 34.25% -> 33.45% (its band is 0.000pp, so that is
   * signal) and 250-wavecode 8.41% -> 7.36%, with 100-square unmoved at 1.45%.
   *
   * Locking to the `full` step instead would also drop densityMultiplier from
   * 1.35 to 1, which is a different variable and takes 100-square from 1.43%
   * to 15.85%.
   */
  nativeResolution?: boolean;
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
    renderScaleMultiplier: 0.96,
    maxPixelRatioMultiplier: 0.98,
    densityMultiplier: 0.88,
    feedbackResolutionMultiplier: 0.88,
  },
  {
    id: 'reduced',
    renderScaleMultiplier: 0.92,
    maxPixelRatioMultiplier: 0.94,
    densityMultiplier: 0.78,
    feedbackResolutionMultiplier: 0.78,
  },
  {
    id: 'low',
    renderScaleMultiplier: 0.84,
    maxPixelRatioMultiplier: 0.88,
    densityMultiplier: 0.68,
    feedbackResolutionMultiplier: 0.65,
  },
  {
    id: 'minimal',
    renderScaleMultiplier: 0.75,
    maxPixelRatioMultiplier: 0.8,
    densityMultiplier: 0.55,
    feedbackResolutionMultiplier: 0.52,
  },
] as const;

const STEADY_REPUBLISH_INTERVAL_SAMPLES = 60;
const EMA_ALPHA = 0.18;
const MIN_WARMUP_SAMPLES = 24;
const DEGRADE_THRESHOLD_SAMPLES = 12;
const RECOVER_THRESHOLD_SAMPLES = 18;
const ENHANCE_THRESHOLD_SAMPLES = 36;
const RESET_THRESHOLD_SAMPLES = 3;
const GPU_RESOLUTION_PRESSURE_SAMPLES = 6;
const GPU_RESOLUTION_RECOVER_SAMPLES = 18;
const GPU_RESOLUTION_MIN = 0.72;
const GPU_RESOLUTION_MAX_CHANGE = 0.06;
const GPU_RESOLUTION_TARGET_BUDGET_RATIO = 0.82;
const ROLLING_WINDOW_DEGRADE_THRESHOLD_SAMPLES = 6;
const ROLLING_WINDOW_MS = 5000;
/**
 * Cadence that still counts as "presenting on target" when looking for
 * headroom. This must be >= 1: a session presenting perfectly at vsync has
 * `cadenceMs === frameBudgetMs`, so requiring cadence to be *faster* than
 * the budget (the old `* 0.9`) made headroom unreachable on exactly the
 * displays most people use — 16.67ms measured against a 15.0ms bar on
 * 60Hz, 8.33 against 7.5 on 120Hz. Quality could then only ever ratchet
 * down, and one transient spike stranded the session at reduced quality
 * for good. The degrade side treats > 1.10 as pressure, so 1.05 leaves a
 * small dead band between "recovering" and "degrading".
 */
const CADENCE_AT_TARGET_RATIO = 1.05;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function resolveGpuResolutionTarget({
  currentMultiplier,
  averageGpuMs,
  frameBudgetMs,
  minimumMultiplier = GPU_RESOLUTION_MIN,
}: {
  currentMultiplier: number;
  averageGpuMs: number;
  frameBudgetMs: number;
  minimumMultiplier?: number;
}) {
  if (averageGpuMs <= 0 || frameBudgetMs <= 0) {
    return currentMultiplier;
  }
  // Fill cost scales approximately with pixel area, so the linear-resolution
  // correction is the square root of the budget ratio. Slew-limit each change
  // to avoid a visible one-frame resolution jump.
  const desired = Math.sqrt(
    (frameBudgetMs * GPU_RESOLUTION_TARGET_BUDGET_RATIO) / averageGpuMs,
  );
  return clamp(
    Math.max(desired, currentMultiplier - GPU_RESOLUTION_MAX_CHANGE),
    minimumMultiplier,
    1,
  );
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
  if (getHardwareSignals().isMobile) {
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
  const signals = getHardwareSignals();

  if (backend === 'webgl') {
    const isDesktopHighEnd =
      !signals.isMobile &&
      !signals.isSmartTv &&
      (signals.hardwareConcurrency === null ||
        signals.hardwareConcurrency >= 6);
    const reasons = [
      isDesktopHighEnd
        ? 'Desktop WebGL sessions start from full quality with coarse frame monitoring.'
        : 'WebGL fallback sessions start from a conservative adaptive quality step.',
      'Coarse CPU frame timing is used because GPU timing is unavailable.',
    ];
    let initialStep = isDesktopHighEnd ? 1 : 2;
    if (signals.isSmartTv) {
      reasons.push(
        'Smart TV hardware operates from a conservative initial quality step.',
      );
      initialStep = Math.max(initialStep, 3);
    }
    return {
      frameBudgetMs,
      initialStep,
      floorStep: 0,
      profile: 'fallback-webgl',
      reasons,
    };
  }

  if (!capabilities) {
    return {
      frameBudgetMs,
      initialStep: 3,
      floorStep: 0,
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

  if (signals.isSmartTv) {
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

  let floorStep = 0;
  if (signals.isMobile) {
    const isFlagshipMobile =
      (capabilities.performanceTier === 'high-end' ||
        capabilities.performanceTier === 'enhanced') &&
      (signals.hardwareConcurrency ?? 0) >= 6;
    // Flagship mobile starts at 'full' (step 1), never 'ultra' (step 0): the
    // render/pixel-ratio caps already bound the effective resolution, and the
    // per-pixel multipliers above 1.0 buy nothing while the phone's single
    // CPU core pays for the extra mesh/wave density and feedback fill.
    floorStep = isFlagshipMobile ? 1 : 2;
    initialStep = Math.max(initialStep, floorStep);
    reasons.push(
      isFlagshipMobile
        ? 'Flagship mobile sessions start from full quality with adaptive throttling headroom.'
        : 'Touch-first mobile sessions start from balanced quality for steadier sustained performance.',
    );
  } else if (signals.isInAppBrowser) {
    initialStep = Math.max(initialStep, 2);
    reasons.push(
      'In-app webview sessions start from balanced quality for steadier sustained performance.',
    );
  }

  initialStep = clamp(initialStep, 0, QUALITY_STEPS.length - 1);

  return {
    frameBudgetMs,
    initialStep,
    floorStep,
    profile: capabilities.performanceTier,
    reasons,
  };
}

function buildState({
  nativeResolution,
  backend,
  timingMode,
  supportsGpuTimestamps,
  profile,
  frameBudgetMs,
  qualityStep,
  gpuResolutionMultiplier,
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
  nativeResolution: boolean;
  backend: RendererBackend;
  timingMode: AdaptiveQualityTimingMode;
  supportsGpuTimestamps: boolean;
  profile: string;
  frameBudgetMs: number;
  qualityStep: number;
  gpuResolutionMultiplier: number;
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
    gpuResolutionMultiplier,
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
    renderScaleMultiplier: nativeResolution
      ? 1
      : step.renderScaleMultiplier * gpuResolutionMultiplier,
    maxPixelRatioMultiplier: nativeResolution
      ? 1
      : step.maxPixelRatioMultiplier * gpuResolutionMultiplier,
    densityMultiplier: step.densityMultiplier,
    feedbackResolutionMultiplier: nativeResolution
      ? 1
      : step.feedbackResolutionMultiplier * gpuResolutionMultiplier,
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
  nativeResolution = false,
}: AdaptiveQualityControllerOptions): AdaptiveQualityController {
  const subscribers = new Set<(state: AdaptiveQualityState) => void>();
  const supportsGpuTimestamps =
    backend === 'webgpu' && Boolean(capabilities?.features.timestampQuery);
  // Capability alone is not a measurement. Stay truthful until the renderer
  // actually supplies a resolved hardware timestamp.
  let timingMode: AdaptiveQualityTimingMode = 'coarse-frame';
  const heuristic = buildHeuristicProfile(backend, capabilities);

  /**
   * When set, the heuristic may keep measuring but never moves the step.
   *
   * Seeded from `lockedQualityStep` for performance runs, and settable at
   * runtime by `setStepLocked` so live performance mode can freeze the
   * picture where it currently is: on a projection, a steady image at a
   * lower quality step beats one that visibly softens and re-sharpens as
   * the controller hunts.
   */
  const configuredStepLock =
    typeof lockedQualityStep === 'number' && Number.isFinite(lockedQualityStep)
      ? Math.min(
          Math.max(Math.round(lockedQualityStep), 0),
          QUALITY_STEPS.length - 1,
        )
      : null;
  let livePerformanceStepLock: number | null = null;
  let stepLock = configuredStepLock;
  let qualityStep = stepLock ?? heuristic.initialStep;
  let gpuResolutionMultiplier = 1;
  let averageFrameMs: number | null = null;
  let averageCadenceMs: number | null = null;
  let averageRenderMs: number | null = null;
  let averageGpuMs: number | null = null;
  let rollingAverageFrameMs: number | null = null;
  let sampleCount = 0;
  let consecutiveOverBudget = 0;
  let consecutiveUnderBudget = 0;
  let consecutiveGpuPressure = 0;
  let consecutiveGpuHeadroom = 0;
  /**
   * The quality step a preset switch pre-degraded *from*, while that step has
   * not been earned back yet — or null when nothing is outstanding.
   *
   * The pre-degrade covers the warm-up cost of ONE switch; without this it
   * compounded across a burst of them. It stores the level rather than a bare
   * flag because pressure can degrade further steps in between: clearing on
   * the first recovery would re-arm the pre-pay while quality was still below
   * where the switch found it, so alternating pressure, one-step recovery and
   * switching would walk downward again — the same ratchet by a slower route.
   */
  let switchPreDegradeFromStep: number | null = null;
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

  function getMinimumGpuResolutionMultiplier(stepIndex = qualityStep) {
    const step = QUALITY_STEPS[stepIndex] as QualityStep;
    // The feedback manager clamps its effective scale at 0.45. Keep telemetry
    // truthful by never publishing a multiplier below that actual floor.
    return Math.max(
      GPU_RESOLUTION_MIN,
      0.45 / step.feedbackResolutionMultiplier,
    );
  }

  function moveQualityStepPreservingResolution(targetStep: number) {
    if (gpuResolutionMultiplier >= 0.999) {
      qualityStep = targetStep;
      gpuResolutionMultiplier = 1;
      return;
    }
    const previousStep = QUALITY_STEPS[qualityStep] as QualityStep;
    const effectiveRenderScale =
      previousStep.renderScaleMultiplier * gpuResolutionMultiplier;
    qualityStep = targetStep;
    const nextStep = QUALITY_STEPS[qualityStep] as QualityStep;
    gpuResolutionMultiplier = clamp(
      effectiveRenderScale / nextStep.renderScaleMultiplier,
      getMinimumGpuResolutionMultiplier(),
      1,
    );
  }

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
    nativeResolution,
    backend,
    timingMode,
    supportsGpuTimestamps,
    profile: heuristic.profile,
    frameBudgetMs: heuristic.frameBudgetMs,
    qualityStep,
    gpuResolutionMultiplier,
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
      nativeResolution,
      backend,
      timingMode,
      supportsGpuTimestamps,
      profile: heuristic.profile,
      frameBudgetMs: heuristic.frameBudgetMs,
      qualityStep,
      gpuResolutionMultiplier,
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
    setStepLocked: (locked: boolean) => {
      // Freezes at the CURRENT step rather than a configured one: by the
      // time a performer asks for this, the controller has already found a
      // step the machine sustains, and that is the one to hold.
      livePerformanceStepLock = locked ? qualityStep : null;
      // A live-performance hold and a configured benchmark lock are
      // independent reasons to freeze adaptation. Releasing the stage hold
      // must reveal the configured lock again instead of silently turning a
      // fixed-quality measurement back into an adaptive one.
      stepLock = livePerformanceStepLock ?? configuredStepLock;
      state = {
        ...state,
        reasons: [
          ...heuristic.reasons,
          locked
            ? `Quality held at ${QUALITY_STEPS[qualityStep].id} for live performance.`
            : configuredStepLock !== null
              ? `Configured quality lock remains at ${QUALITY_STEPS[qualityStep].id}.`
              : 'Quality adaptation resumed.',
        ],
      };
      return publish();
    },
    setQualityStep: (step: number) => {
      const targetStep = Math.min(
        Math.max(Math.round(step), 0),
        QUALITY_STEPS.length - 1,
      );
      qualityStep = targetStep;
      gpuResolutionMultiplier = 1;
      // An explicit set overrides whatever the switch pre-payment was tracking;
      // holding a stale level would suppress the next switch's pre-pay.
      switchPreDegradeFromStep = null;
      adaptation = 'steady';
      consecutiveOverBudget = 0;
      consecutiveUnderBudget = 0;
      consecutiveGpuPressure = 0;
      consecutiveGpuHeadroom = 0;
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
        timingMode = 'gpu-phase-timestamps';
        averageGpuMs = updateEma(averageGpuMs, gpuMs);
      }

      if (sampleCount < MIN_WARMUP_SAMPLES) {
        // During warmup, only publish every 4th sample to reduce GC pressure
        if (sampleCount % 4 === 0 || sampleCount === 1) {
          return publish();
        }
        return state;
      }

      if (sampleCount === MIN_WARMUP_SAMPLES) {
        // On completing warmup, seed EMAs with the settled post-warmup frame
        // and reset the rolling window so startup compilation spikes don't falsely
        // trigger immediate degradation.
        averageFrameMs = frameMs;
        averageRenderMs =
          typeof renderMs === 'number' && Number.isFinite(renderMs)
            ? renderMs
            : null;
        averageCadenceMs =
          typeof cadenceMs === 'number' && Number.isFinite(cadenceMs)
            ? cadenceMs
            : null;
        averageGpuMs =
          supportsGpuTimestamps &&
          typeof gpuMs === 'number' &&
          Number.isFinite(gpuMs)
            ? gpuMs
            : null;
        consecutiveOverBudget = 0;
        consecutiveUnderBudget = 0;
        resetRollingWindowAfterStepChange();
      }

      const renderPressure =
        averageRenderMs !== null &&
        averageRenderMs > heuristic.frameBudgetMs * 0.9;
      const gpuPressure =
        averageGpuMs !== null && averageGpuMs > heuristic.frameBudgetMs * 0.9;
      const framePressure =
        averageFrameMs !== null &&
        averageFrameMs > heuristic.frameBudgetMs * 1.1;
      const cadencePressure =
        averageCadenceMs !== null &&
        averageCadenceMs > heuristic.frameBudgetMs * 1.12 &&
        (averageFrameMs === null ||
          averageFrameMs > heuristic.frameBudgetMs * 0.85);
      const hasHeadroom =
        averageFrameMs !== null &&
        averageFrameMs < heuristic.frameBudgetMs * 0.75 &&
        (averageCadenceMs === null ||
          averageCadenceMs <=
            heuristic.frameBudgetMs * CADENCE_AT_TARGET_RATIO) &&
        (averageRenderMs === null ||
          averageRenderMs < heuristic.frameBudgetMs * 0.7) &&
        (averageGpuMs === null || averageGpuMs < heuristic.frameBudgetMs * 0.7);
      const rollingFramePressure =
        rollingAverageFrameMs !== null &&
        rollingAverageFrameMs > heuristic.frameBudgetMs;
      if (rollingFramePressure) {
        consecutiveRollingOverBudget += 1;
      } else {
        consecutiveRollingOverBudget = 0;
      }

      // Check if current frame is an isolated transient spike/outlier
      // (e.g., GC pause or compositor hitch where single frameMs > 2x budget, but GPU & render time are normal and rolling window is calm)
      const isTransientHitch =
        frameMs > heuristic.frameBudgetMs * 2.0 &&
        (averageRenderMs === null ||
          averageRenderMs <= heuristic.frameBudgetMs * 0.9) &&
        (averageGpuMs === null ||
          averageGpuMs <= heuristic.frameBudgetMs * 0.9) &&
        !rollingFramePressure;

      const hasMeasuredGpuTiming =
        timingMode === 'gpu-phase-timestamps' && averageGpuMs !== null;
      if (hasMeasuredGpuTiming && gpuPressure && !isTransientHitch) {
        consecutiveGpuPressure += 1;
        consecutiveGpuHeadroom = 0;
      } else if (
        hasMeasuredGpuTiming &&
        hasHeadroom &&
        averageGpuMs !== null &&
        averageGpuMs < heuristic.frameBudgetMs * 0.65
      ) {
        consecutiveGpuHeadroom += 1;
        consecutiveGpuPressure = 0;
      } else {
        consecutiveGpuPressure = Math.max(0, consecutiveGpuPressure - 1);
        consecutiveGpuHeadroom = Math.max(0, consecutiveGpuHeadroom - 1);
      }

      if (
        !isTransientHitch &&
        (renderPressure || gpuPressure || framePressure || cadencePressure)
      ) {
        consecutiveOverBudget += 1;
        consecutiveUnderBudget = 0;
      } else if (hasHeadroom) {
        consecutiveUnderBudget += 1;
        consecutiveOverBudget = 0;
      } else {
        consecutiveOverBudget = Math.max(0, consecutiveOverBudget - 1);
        consecutiveUnderBudget = Math.max(0, consecutiveUnderBudget - 1);
      }

      const minimumGpuResolutionMultiplier =
        getMinimumGpuResolutionMultiplier();
      if (
        stepLock === null &&
        consecutiveGpuPressure >= GPU_RESOLUTION_PRESSURE_SAMPLES &&
        averageGpuMs !== null &&
        gpuResolutionMultiplier > minimumGpuResolutionMultiplier + 0.001
      ) {
        const nextMultiplier = resolveGpuResolutionTarget({
          currentMultiplier: gpuResolutionMultiplier,
          averageGpuMs,
          frameBudgetMs: heuristic.frameBudgetMs,
          minimumMultiplier: minimumGpuResolutionMultiplier,
        });
        if (nextMultiplier < gpuResolutionMultiplier - 0.001) {
          gpuResolutionMultiplier = nextMultiplier;
          adaptation = 'degraded';
          consecutiveGpuPressure = 0;
          consecutiveOverBudget = 0;
          consecutiveUnderBudget = 0;
          resetRollingWindowAfterStepChange();
          state = {
            ...state,
            reasons: [
              ...heuristic.reasons,
              `Measured GPU pressure trimmed render resolution to ${Math.round(gpuResolutionMultiplier * 100)}% without changing geometry density.`,
            ],
          };
          return publish();
        }
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
        moveQualityStepPreservingResolution(qualityStep + 1);
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
        consecutiveGpuHeadroom >= GPU_RESOLUTION_RECOVER_SAMPLES &&
        gpuResolutionMultiplier < 0.999
      ) {
        gpuResolutionMultiplier = Math.min(
          1,
          gpuResolutionMultiplier + GPU_RESOLUTION_MAX_CHANGE,
        );
        adaptation = 'recovering';
        consecutiveGpuHeadroom = 0;
        consecutiveOverBudget = 0;
        consecutiveUnderBudget = 0;
        resetRollingWindowAfterStepChange();
        state = {
          ...state,
          reasons: [
            ...heuristic.reasons,
            `Measured GPU headroom restored render resolution to ${Math.round(gpuResolutionMultiplier * 100)}%.`,
          ],
        };
        return publish();
      }

      if (
        stepLock === null &&
        consecutiveUnderBudget >= RECOVER_THRESHOLD_SAMPLES &&
        qualityStep > heuristic.initialStep
      ) {
        moveQualityStepPreservingResolution(qualityStep - 1);
        if (
          switchPreDegradeFromStep !== null &&
          qualityStep <= switchPreDegradeFromStep
        ) {
          // Back to (or above) where the switch found us: the pre-payment has
          // genuinely been earned back, so a later switch may pre-pay again.
          switchPreDegradeFromStep = null;
        }
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
        qualityStep > heuristic.floorStep &&
        (heuristic.profile === 'high-end' || heuristic.profile === 'enhanced')
      ) {
        moveQualityStepPreservingResolution(qualityStep - 1);
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

      // Steady frames never hit a publish() branch above, so without this the
      // published state (telemetry, HUD, agent bridge) freezes on the last
      // warmup snapshot — including startup-spike averages and a spurious
      // thermalState — for the rest of the session. Republish about once a
      // second so observers track the live EMAs without per-frame GC churn.
      if (sampleCount % STEADY_REPUBLISH_INTERVAL_SAMPLES === 0) {
        return publish();
      }

      return state;
    },
    notePresetApplied: () => {
      // A preset switch invalidates pressure evidence the same way a step
      // change does: the frames behind the averages were rendered under the
      // previous preset's workload.
      consecutiveOverBudget = 0;
      consecutiveUnderBudget = 0;
      resetRollingWindowAfterStepChange();

      const constrainedProfile =
        heuristic.profile !== 'high-end' && heuristic.profile !== 'enhanced';
      // The session-start warmup path (MIN_WARMUP_SAMPLES) already seeds the
      // boot conservatively; the pre-degrade is for switches after that.
      // One outstanding pre-degrade at a time. This is charged per switch,
      // but earning a step back costs RECOVER_THRESHOLD_SAMPLES *consecutive*
      // under-budget frames — and the reset above clears that counter on
      // every switch. Stacking therefore made the two directions wildly
      // asymmetric: swiping through presets faster than the recovery window
      // walked quality from `full` to `minimal` in four switches on frames
      // that were never once over budget, coarsening the mesh and halving
      // feedback resolution for no measured reason. The warm-up this exists
      // to absorb belongs to a single switch, so charge it once and let it be
      // earned back before charging it again.
      if (
        stepLock === null &&
        constrainedProfile &&
        switchPreDegradeFromStep === null &&
        sampleCount >= MIN_WARMUP_SAMPLES &&
        qualityStep < QUALITY_STEPS.length - 1
      ) {
        switchPreDegradeFromStep = qualityStep;
        moveQualityStepPreservingResolution(qualityStep + 1);
        adaptation = 'degraded';
        state = {
          ...state,
          reasons: [
            ...heuristic.reasons,
            'Preset switch: warming up at a reduced quality step.',
          ],
        };
      }
      return publish();
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
