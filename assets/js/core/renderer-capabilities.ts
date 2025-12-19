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

type FallbackOptions = {
  triedWebGPU?: boolean;
  shouldRetryWebGPU?: boolean;
};

let capabilitiesPromise: Promise<RendererCapabilities> | null = null;
let cachedCapabilities: RendererCapabilities | null = null;

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
  capabilitiesPromise = null;
  cachedCapabilities = null;
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
  capabilitiesPromise = Promise.resolve(result);
  return result;
}

export async function getRendererCapabilities({ forceRetry = false } = {}) {
  if (forceRetry) {
    capabilitiesPromise = null;
  }

  if (!capabilitiesPromise) {
    capabilitiesPromise = probeRendererCapabilities();
  }

  return capabilitiesPromise;
}

export function getCachedRendererCapabilities() {
  return cachedCapabilities;
}
