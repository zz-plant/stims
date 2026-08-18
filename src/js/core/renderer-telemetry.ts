import { createLogger } from './logger.ts';
import {
  type RendererOptimizationTelemetryDetail,
  setRendererTelemetryHandler,
} from './renderer-capabilities.ts';

const logger = createLogger('RendererTelemetry');

const STORAGE_KEY = 'stims:renderer-support-stats';

function readTelemetryStats(): Record<string, unknown> {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  window.localStorage.removeItem(STORAGE_KEY);
  return {};
}

function writeTelemetryStats(nextStats: Record<string, unknown>) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStats));
}

function installRendererSupportTelemetry() {
  setRendererTelemetryHandler((_event, detail) => {
    try {
      const existing = readTelemetryStats();
      writeTelemetryStats({
        samples: Number(existing.samples ?? 0) + 1,
        webgpu: Number(existing.webgpu ?? 0) + Number(detail.isWebGPUSupported),
        webglFallback:
          Number(existing.webglFallback ?? 0) +
          Number(!detail.isWebGPUSupported),
        hiFiReady:
          Number(existing.hiFiReady ?? 0) +
          Number(detail.webgpu?.recommendedQualityPreset === 'hi-fi'),
        timestampQuery:
          Number(existing.timestampQuery ?? 0) +
          Number(detail.webgpu?.optimization.timestampQuery === true),
        shaderF16:
          Number(existing.shaderF16 ?? 0) +
          Number(detail.webgpu?.optimization.shaderF16 === true),
        subgroups:
          Number(existing.subgroups ?? 0) +
          Number(detail.webgpu?.optimization.subgroups === true),
        workerOffscreenReady:
          Number(existing.workerOffscreenReady ?? 0) +
          Number(detail.webgpu?.optimization.workerOffscreenPipeline === true),
        lastFallbackReason: detail.fallbackReason,
        lastPreferredCanvasFormat: detail.webgpu?.preferredCanvasFormat ?? null,
        lastPerformanceTier: detail.webgpu?.performanceTier ?? null,
        lastOptimizationSupport: detail.webgpu?.optimization ?? null,
        lastRetryPolicy: detail.retry,
        optimizationCounters:
          existing.optimizationCounters &&
          typeof existing.optimizationCounters === 'object'
            ? existing.optimizationCounters
            : {},
        lastUpdatedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.log('Failed to write support telemetry:', error);
    }
  });
}

function installOptimizationTelemetry() {
  if (typeof window === 'undefined' || !window.addEventListener) {
    return;
  }

  window.addEventListener(
    'stims:renderer-optimization-telemetry',
    (
      event: Event & {
        detail?: RendererOptimizationTelemetryDetail;
      },
    ) => {
      try {
        const detail = event.detail;
        if (!detail?.counter) {
          return;
        }

        const existing = readTelemetryStats();
        const counters: Record<string, unknown> =
          existing.optimizationCounters &&
          typeof existing.optimizationCounters === 'object'
            ? (existing.optimizationCounters as Record<string, unknown>)
            : {};

        counters[detail.counter] =
          Number(counters[detail.counter] ?? 0) + Number(detail.amount ?? 1);

        writeTelemetryStats({
          ...existing,
          optimizationCounters: counters,
          lastOptimizationCounter: detail.counter,
          lastOptimizationCounterAmount: Number(detail.amount ?? 1),
          lastUpdatedAt: new Date().toISOString(),
        });
      } catch (error) {
        logger.log('Failed to write optimization telemetry:', error);
      }
    },
  );
}

import { getDeviceTier } from './device-profile.ts';
import { getActiveAdaptiveQualityController } from './services/adaptive-quality-controller.ts';

export type StimsTelemetryAPI = {
  getLiveStats: () => {
    deviceTier: string | null;
    qualityPreset: string | null;
    hardwareConcurrency: number | null;
    deviceMemory: number | null;
    adaptiveState: ReturnType<
      import('./services/adaptive-quality-controller.ts').AdaptiveQualityController['getState']
    > | null;
    persistedStats: Record<string, unknown>;
  };
  setQualityStep: (step: number) => boolean;
  readTelemetryStats: () => Record<string, unknown>;
};

function installGlobalTelemetryAPI() {
  if (typeof window === 'undefined') return;

  const api: StimsTelemetryAPI = {
    getLiveStats: () => {
      const controller = getActiveAdaptiveQualityController();
      const adaptiveState = controller ? controller.getState() : null;
      const deviceMemory =
        'deviceMemory' in navigator
          ? ((navigator as Navigator & { deviceMemory?: number })
              .deviceMemory ?? null)
          : null;

      return {
        deviceTier:
          document.documentElement.dataset.deviceTier ?? getDeviceTier(),
        qualityPreset: document.documentElement.dataset.qualityPreset ?? null,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        deviceMemory,
        adaptiveState,
        persistedStats: readTelemetryStats(),
      };
    },
    setQualityStep: (step: number) => {
      const controller = getActiveAdaptiveQualityController();
      if (!controller) return false;
      controller.setQualityStep(step);
      return true;
    },
    readTelemetryStats: () => readTelemetryStats(),
  };

  (
    window as unknown as { __stims_telemetry?: StimsTelemetryAPI }
  ).__stims_telemetry = api;
}

export function installRendererTelemetryPersistence() {
  installRendererSupportTelemetry();
  installOptimizationTelemetry();
  installGlobalTelemetryAPI();
}

/**
 * The reason recorded the last time the renderer probe fell back from
 * WebGPU, or null when the last probe succeeded (or nothing is stored).
 * Lets the settings UI answer "why am I on WebGL?" without devtools.
 */
export function getLastRendererFallbackReason(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const reason = readTelemetryStats().lastFallbackReason;
    return typeof reason === 'string' && reason.length > 0 ? reason : null;
  } catch {
    return null;
  }
}
