import {
  type RendererOptimizationTelemetryDetail,
  setRendererTelemetryHandler,
} from './renderer-capabilities.ts';

const STORAGE_KEY = 'stims:renderer-support-stats';

function readTelemetryStats() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
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
        optimizationCounters:
          existing.optimizationCounters &&
          typeof existing.optimizationCounters === 'object'
            ? existing.optimizationCounters
            : {},
        lastUpdatedAt: new Date().toISOString(),
      });
    } catch (_error) {
      // Ignore telemetry persistence failures.
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
        const counters =
          existing.optimizationCounters &&
          typeof existing.optimizationCounters === 'object'
            ? existing.optimizationCounters
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
      } catch (_error) {
        // Ignore telemetry persistence failures.
      }
    },
  );
}

export function installRendererTelemetryPersistence() {
  installRendererSupportTelemetry();
  installOptimizationTelemetry();
}
