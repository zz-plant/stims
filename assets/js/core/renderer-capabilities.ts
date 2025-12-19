/* global GPUAdapter, GPUDevice, GPU */

export type RendererBackend = 'webgl' | 'webgpu';

export type RendererCapabilities = {
  preferredBackend: RendererBackend;
  adapter: GPUAdapter | null;
  device: GPUDevice | null;
  triedWebGPU: boolean;
  fallbackReason: string | null;
  shouldRetryWebGPU: boolean;
};

export type RendererCapabilitySummary = {
  backendLabel: string;
  description: string;
  fallbackDetail: string | null;
  shouldRetryWebGPU: boolean;
  triedWebGPU: boolean;
  preferredBackend: RendererBackend;
};

type FallbackOptions = {
  triedWebGPU?: boolean;
  shouldRetryWebGPU?: boolean;
};

let capabilitiesPromise: Promise<RendererCapabilities> | null = null;
let cachedCapabilities: RendererCapabilities | null = null;
let cachedEnvironmentKey: unknown = null;

const buildFallback = (
  fallbackReason: string,
  { triedWebGPU = false, shouldRetryWebGPU = false }: FallbackOptions = {}
): RendererCapabilities => ({
  preferredBackend: 'webgl',
  adapter: null,
  device: null,
  triedWebGPU,
  fallbackReason,
  shouldRetryWebGPU,
});

const cacheResult = (result: RendererCapabilities) => {
  cachedCapabilities = result;
  return result;
};

function getEnvironmentKey() {
  if (typeof navigator === 'undefined') return 'no-navigator';
  const nav = navigator as Navigator & { gpu?: GPU; userAgent?: string };
  return nav.gpu ?? nav.userAgent ?? nav;
}

function resetCache() {
  capabilitiesPromise = null;
  cachedCapabilities = null;
}

async function probeRendererCapabilities(): Promise<RendererCapabilities> {
  if (typeof navigator === 'undefined') {
    return cacheResult(buildFallback('Renderer capabilities are unavailable.'));
  }

  const { gpu } = navigator as Navigator & { gpu?: GPU };
  if (!gpu?.requestAdapter) {
    return cacheResult(
      buildFallback('WebGPU is not available in this browser.', {
        triedWebGPU: false,
        shouldRetryWebGPU: false,
      })
    );
  }

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return cacheResult(
        buildFallback('No compatible WebGPU adapter was found.', {
          triedWebGPU: true,
          shouldRetryWebGPU: true,
        })
      );
    }

    let device: GPUDevice | null = null;
    try {
      device = await adapter.requestDevice();
    } catch (error) {
      console.warn('WebGPU device request failed. Falling back to WebGL.', error);
      return cacheResult(
        buildFallback('Unable to acquire a WebGPU device.', {
          triedWebGPU: true,
          shouldRetryWebGPU: true,
        })
      );
    }

    if (!device) {
      return cacheResult(
        buildFallback('WebGPU device request returned no device.', {
          triedWebGPU: true,
          shouldRetryWebGPU: true,
        })
      );
    }

    return cacheResult({
      preferredBackend: 'webgpu',
      adapter,
      device,
      triedWebGPU: true,
      fallbackReason: null,
      shouldRetryWebGPU: false,
    });
  } catch (error) {
    console.warn('WebGPU initialization failed. Falling back to WebGL.', error);
    return cacheResult(
      buildFallback('WebGPU initialization failed.', {
        triedWebGPU: true,
        shouldRetryWebGPU: true,
      })
    );
  }
}

export function resetRendererCapabilities() {
  resetCache();
  cachedEnvironmentKey = null;
}

export function rememberRendererFallback(
  fallbackReason: string,
  {
    shouldRetryWebGPU = false,
    triedWebGPU = true,
  }: { shouldRetryWebGPU?: boolean; triedWebGPU?: boolean } = {}
) {
  const result = cacheResult(
    buildFallback(fallbackReason, {
      triedWebGPU,
      shouldRetryWebGPU,
    })
  );
  cachedEnvironmentKey = getEnvironmentKey();
  capabilitiesPromise = Promise.resolve(result);
  return result;
}

export async function getRendererCapabilities({ forceRetry = false } = {}) {
  const environmentKey = getEnvironmentKey();
  const environmentChanged = environmentKey !== cachedEnvironmentKey;

  if (forceRetry || environmentChanged) {
    resetCache();
  }

  cachedEnvironmentKey = environmentKey;

  if (!capabilitiesPromise) {
    capabilitiesPromise = probeRendererCapabilities();
  }

  return capabilitiesPromise;
}

export function describeRendererCapabilities(
  capabilities: RendererCapabilities
): RendererCapabilitySummary {
  const backendLabel = capabilities.preferredBackend === 'webgpu' ? 'WebGPU' : 'WebGL';
  const fallbackDetail =
    capabilities.preferredBackend === 'webgl'
      ? capabilities.fallbackReason
        ? `WebGPU unavailable: ${capabilities.fallbackReason}`
        : 'Using WebGL renderer.'
      : null;

  const description =
    capabilities.preferredBackend === 'webgpu'
      ? 'WebGPU active'
      : fallbackDetail ?? 'WebGL fallback';

  return {
    backendLabel,
    description,
    fallbackDetail,
    shouldRetryWebGPU: capabilities.shouldRetryWebGPU,
    triedWebGPU: capabilities.triedWebGPU,
    preferredBackend: capabilities.preferredBackend,
  };
}

export function getCachedRendererCapabilities() {
  return cachedCapabilities;
}
