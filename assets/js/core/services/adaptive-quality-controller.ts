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
  averageRenderMs: number | null;
  sampleCount: number;
  adaptation: 'steady' | 'degraded' | 'recovering';
  reasons: string[];
};

export type AdaptiveQualityController = {
  getState: () => AdaptiveQualityState;
  recordFrame: (sample: AdaptiveQualitySample) => AdaptiveQualityState;
  subscribe: (subscriber: (state: AdaptiveQualityState) => void) => () => void;
};

type AdaptiveQualityControllerOptions = {
  backend: RendererBackend;
  capabilities: WebGPUCapabilitySummary | null;
};

type QualityStep = AdaptiveQualityMultipliers & {
  id: string;
};

const QUALITY_STEPS: readonly QualityStep[] = [
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
const RECOVER_THRESHOLD_SAMPLES = 45;
const RESET_THRESHOLD_SAMPLES = 3;

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

function buildHeuristicProfile(capabilities: WebGPUCapabilitySummary | null) {
  if (!capabilities) {
    return {
      frameBudgetMs: 16.7,
      initialStep: 2,
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

  if (!capabilities.features.float32Blendable) {
    reasons.push('float32 blendable attachments are unavailable.');
    initialStep += 1;
  }
  if (!capabilities.features.float32Filterable) {
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

  initialStep = clamp(initialStep, 0, QUALITY_STEPS.length - 1);

  return {
    frameBudgetMs: 16.7,
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
  averageRenderMs,
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
  averageRenderMs: number | null;
  sampleCount: number;
  adaptation: AdaptiveQualityState['adaptation'];
  reasons: string[];
}) {
  const step = QUALITY_STEPS[qualityStep] as QualityStep;
  return {
    enabled: backend === 'webgpu',
    backend,
    timingMode,
    supportsGpuTimestamps,
    profile,
    frameBudgetMs,
    qualityStep,
    qualityStepCount: QUALITY_STEPS.length,
    averageFrameMs,
    averageRenderMs,
    sampleCount,
    adaptation,
    reasons,
    renderScaleMultiplier: step.renderScaleMultiplier,
    maxPixelRatioMultiplier: step.maxPixelRatioMultiplier,
    densityMultiplier: step.densityMultiplier,
    feedbackResolutionMultiplier: step.feedbackResolutionMultiplier,
  } satisfies AdaptiveQualityState;
}

export function createAdaptiveQualityController({
  backend,
  capabilities,
}: AdaptiveQualityControllerOptions): AdaptiveQualityController {
  const subscribers = new Set<(state: AdaptiveQualityState) => void>();
  const timingMode: AdaptiveQualityTimingMode = 'coarse-frame';
  const supportsGpuTimestamps =
    backend === 'webgpu' && Boolean(capabilities?.features.timestampQuery);
  const heuristic = buildHeuristicProfile(
    backend === 'webgpu' ? capabilities : null,
  );

  let qualityStep = backend === 'webgpu' ? heuristic.initialStep : 0;
  let averageFrameMs: number | null = null;
  let averageRenderMs: number | null = null;
  let sampleCount = 0;
  let consecutiveOverBudget = 0;
  let consecutiveUnderBudget = 0;
  let adaptation: AdaptiveQualityState['adaptation'] = 'steady';

  let state = buildState({
    backend,
    timingMode,
    supportsGpuTimestamps,
    profile: heuristic.profile,
    frameBudgetMs: heuristic.frameBudgetMs,
    qualityStep,
    averageFrameMs,
    averageRenderMs,
    sampleCount,
    adaptation,
    reasons:
      backend === 'webgpu'
        ? [
            ...heuristic.reasons,
            supportsGpuTimestamps
              ? 'timestamp-query is available for future GPU timing upgrades.'
              : 'Falling back to coarse CPU frame timing for now.',
          ]
        : ['Adaptive quality is disabled outside the WebGPU backend.'],
  });

  const publish = () => {
    state = buildState({
      backend,
      timingMode,
      supportsGpuTimestamps,
      profile: heuristic.profile,
      frameBudgetMs: heuristic.frameBudgetMs,
      qualityStep,
      averageFrameMs,
      averageRenderMs,
      sampleCount,
      adaptation,
      reasons: state.reasons,
    });
    subscribers.forEach((subscriber) => subscriber(state));
    return state;
  };

  return {
    getState: () => state,
    recordFrame: ({ frameMs, phases }: AdaptiveQualitySample) => {
      if (backend !== 'webgpu' || !Number.isFinite(frameMs)) {
        return state;
      }

      sampleCount += 1;
      averageFrameMs = updateEma(averageFrameMs, frameMs);
      const renderMs = phases?.renderMs;
      if (typeof renderMs === 'number' && Number.isFinite(renderMs)) {
        averageRenderMs = updateEma(averageRenderMs, renderMs);
      }

      if (sampleCount < MIN_WARMUP_SAMPLES) {
        return publish();
      }

      const renderPressure =
        averageRenderMs !== null &&
        averageRenderMs > heuristic.frameBudgetMs * 0.82;
      const framePressure =
        averageFrameMs !== null &&
        averageFrameMs > heuristic.frameBudgetMs * 1.08;
      const hasHeadroom =
        averageFrameMs !== null &&
        averageFrameMs < heuristic.frameBudgetMs * 0.72 &&
        (averageRenderMs === null ||
          averageRenderMs < heuristic.frameBudgetMs * 0.55);

      if (renderPressure || framePressure) {
        consecutiveOverBudget += 1;
        consecutiveUnderBudget = 0;
      } else if (hasHeadroom) {
        consecutiveUnderBudget += 1;
        consecutiveOverBudget = 0;
      } else {
        consecutiveOverBudget = Math.max(0, consecutiveOverBudget - 1);
        consecutiveUnderBudget = Math.max(0, consecutiveUnderBudget - 1);
      }

      if (
        consecutiveOverBudget >= DEGRADE_THRESHOLD_SAMPLES &&
        qualityStep < QUALITY_STEPS.length - 1
      ) {
        qualityStep += 1;
        adaptation = 'degraded';
        consecutiveOverBudget = 0;
        consecutiveUnderBudget = 0;
        state = {
          ...state,
          reasons: [
            ...heuristic.reasons,
            'Coarse frame timing pushed the controller below the baseline budget.',
          ],
        };
        return publish();
      }

      if (
        consecutiveUnderBudget >= RECOVER_THRESHOLD_SAMPLES &&
        qualityStep > heuristic.initialStep
      ) {
        qualityStep -= 1;
        adaptation = 'recovering';
        consecutiveOverBudget = 0;
        consecutiveUnderBudget = 0;
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
        adaptation !== 'steady' &&
        consecutiveOverBudget < RESET_THRESHOLD_SAMPLES &&
        consecutiveUnderBudget < RESET_THRESHOLD_SAMPLES
      ) {
        adaptation = 'steady';
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
}
