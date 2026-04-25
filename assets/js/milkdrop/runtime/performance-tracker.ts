export type MilkdropRuntimePerformanceSample = {
  frameMs: number;
  simulationMs: number;
  renderMs: number;
};

export type MilkdropRuntimeGpuTimings = {
  gpuSimulationMs: number | null;
  gpuRenderMs: number | null;
  gpuPostprocessMs: number | null;
  gpuTotalMs: number | null;
  available: boolean;
};

export type MilkdropRuntimePerformanceSnapshot = {
  sampleCount: number;
  windowSize: number;
  averageFrameMs: number | null;
  averageSimulationMs: number | null;
  averageRenderMs: number | null;
  p95FrameMs: number | null;
  maxFrameMs: number | null;
  gpuTimings: MilkdropRuntimeGpuTimings | null;
};

export function createMilkdropRuntimePerformanceTracker(windowSize = 120) {
  const resolvedWindowSize = Math.max(1, Math.floor(windowSize) || 1);
  const samples: Array<MilkdropRuntimePerformanceSample | null> = new Array(
    resolvedWindowSize,
  ).fill(null);
  let sampleCount = 0;
  let sampleCountInWindow = 0;
  let nextIndex = 0;
  let totalFrameMs = 0;
  let totalSimulationMs = 0;
  let totalRenderMs = 0;
  let latestGpuTimings: MilkdropRuntimeGpuTimings | null = null;

  const recordFrame = (sample: MilkdropRuntimePerformanceSample) => {
    const removed = samples[nextIndex];
    if (removed) {
      totalFrameMs -= removed.frameMs;
      totalSimulationMs -= removed.simulationMs;
      totalRenderMs -= removed.renderMs;
    } else {
      sampleCountInWindow += 1;
    }

    sampleCount += 1;
    samples[nextIndex] = sample;
    nextIndex = (nextIndex + 1) % resolvedWindowSize;
    totalFrameMs += sample.frameMs;
    totalSimulationMs += sample.simulationMs;
    totalRenderMs += sample.renderMs;
  };

  const recordGpuTimings = (timings: MilkdropRuntimeGpuTimings) => {
    latestGpuTimings = timings;
  };

  const getSnapshot = (): MilkdropRuntimePerformanceSnapshot => {
    if (sampleCountInWindow === 0) {
      return {
        sampleCount,
        windowSize: resolvedWindowSize,
        averageFrameMs: null,
        averageSimulationMs: null,
        averageRenderMs: null,
        p95FrameMs: null,
        maxFrameMs: null,
        gpuTimings: latestGpuTimings,
      };
    }

    const frameSamples = samples
      .filter(
        (sample): sample is MilkdropRuntimePerformanceSample => sample !== null,
      )
      .map((sample) => sample.frameMs)
      .sort((a, b) => a - b);
    const p95Index = Math.min(
      frameSamples.length - 1,
      Math.max(0, Math.ceil(frameSamples.length * 0.95) - 1),
    );

    return {
      sampleCount,
      windowSize: resolvedWindowSize,
      averageFrameMs: totalFrameMs / sampleCountInWindow,
      averageSimulationMs: totalSimulationMs / sampleCountInWindow,
      averageRenderMs: totalRenderMs / sampleCountInWindow,
      p95FrameMs: frameSamples[p95Index] ?? null,
      maxFrameMs: frameSamples[frameSamples.length - 1] ?? null,
      gpuTimings: latestGpuTimings,
    };
  };

  const reset = () => {
    samples.fill(null);
    sampleCount = 0;
    sampleCountInWindow = 0;
    nextIndex = 0;
    totalFrameMs = 0;
    totalSimulationMs = 0;
    totalRenderMs = 0;
    latestGpuTimings = null;
  };

  return {
    recordFrame,
    recordGpuTimings,
    getSnapshot,
    reset,
  };
}
