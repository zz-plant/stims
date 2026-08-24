type TimestampRenderer = {
  isWebGPURenderer?: boolean;
  hasFeature?: (name: string) => boolean;
  resolveTimestampsAsync?: (type?: string) => Promise<number | undefined>;
};

const DEFAULT_SAMPLE_INTERVAL_FRAMES = 30;

function isTimestampRenderer(renderer: unknown): renderer is TimestampRenderer {
  if (!renderer || typeof renderer !== 'object') return false;
  const candidate = renderer as TimestampRenderer;
  if (
    candidate.isWebGPURenderer !== true ||
    typeof candidate.resolveTimestampsAsync !== 'function'
  ) {
    return false;
  }
  if (typeof candidate.hasFeature !== 'function') return true;
  try {
    return candidate.hasFeature('timestamp-query');
  } catch {
    return false;
  }
}

/**
 * Drains Three.js WebGPU timestamp queries without awaiting on the frame path.
 * A resolved duration is handed to the adaptive controller exactly once; the
 * controller's EMA carries it until another hardware sample arrives.
 */
export function createGpuRenderTimingSampler({
  sampleIntervalFrames = DEFAULT_SAMPLE_INTERVAL_FRAMES,
}: {
  sampleIntervalFrames?: number;
} = {}) {
  const interval = Math.max(1, Math.round(sampleIntervalFrames));
  let activeRenderer: TimestampRenderer | null = null;
  let framesSinceResolve = 0;
  let resolveInFlight = false;
  let pendingSample: number | undefined;
  let rendererGeneration = 0;

  const resetForRenderer = (renderer: TimestampRenderer | null) => {
    activeRenderer = renderer;
    framesSinceResolve = 0;
    resolveInFlight = false;
    pendingSample = undefined;
    rendererGeneration += 1;
  };

  return {
    sample(renderer: unknown): number | undefined {
      const timestampRenderer = isTimestampRenderer(renderer) ? renderer : null;
      if (timestampRenderer !== activeRenderer) {
        resetForRenderer(timestampRenderer);
      }
      if (!timestampRenderer) return undefined;

      const availableSample = pendingSample;
      pendingSample = undefined;
      framesSinceResolve += 1;

      if (framesSinceResolve >= interval && !resolveInFlight) {
        framesSinceResolve = 0;
        resolveInFlight = true;
        const generation = rendererGeneration;
        void timestampRenderer
          .resolveTimestampsAsync?.('render')
          .then((durationMs) => {
            if (
              generation === rendererGeneration &&
              typeof durationMs === 'number' &&
              Number.isFinite(durationMs) &&
              durationMs > 0
            ) {
              pendingSample = durationMs;
            }
          })
          .catch(() => {})
          .finally(() => {
            if (generation === rendererGeneration) {
              resolveInFlight = false;
            }
          });
      }

      return availableSample;
    },
  };
}
