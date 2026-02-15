/* global GPUAdapter, GPUDevice, GPU */

import WebGL from 'three/examples/jsm/capabilities/WebGL.js';

import { isCompatibilityModeEnabled } from './render-preferences.ts';

export type RendererBackend = 'webgl' | 'webgpu';

export type RendererCapabilities = {
  preferredBackend: RendererBackend;
  adapter: GPUAdapter | null;
  device: GPUDevice | null;
  triedWebGPU: boolean;
  fallbackReason: string | null;
  shouldRetryWebGPU: boolean;
};

export type RendererTelemetryEvent = {
  preferredBackend: RendererBackend;
  triedWebGPU: boolean;
  fallbackReason: string | null;
  isWebGPUSupported: boolean;
};

export type RendererTelemetryHandler = (
  event: 'renderer_capabilities',
  detail: RendererTelemetryEvent,
) => void;

export type RenderingSupport = {
  hasWebGPU: boolean;
  hasWebGL: boolean;
};

type FallbackOptions = {
  triedWebGPU?: boolean;
  shouldRetryWebGPU?: boolean;
};

let capabilitiesPromise: Promise<RendererCapabilities> | null = null;
let cachedCapabilities: RendererCapabilities | null = null;
let cachedEnvironmentKey: unknown = null;
let telemetryHandler: RendererTelemetryHandler | null = null;
let telemetryReportedKey: unknown = null;

const buildFallback = (
  fallbackReason: string,
  { triedWebGPU = false, shouldRetryWebGPU = false }: FallbackOptions = {},
): RendererCapabilities => ({
  preferredBackend: 'webgl',
  adapter: null,
  device: null,
  triedWebGPU,
  fallbackReason,
  shouldRetryWebGPU,
});

const reportRendererTelemetry = (result: RendererCapabilities) => {
  const environmentKey = cachedEnvironmentKey ?? getEnvironmentKey();
  if (telemetryReportedKey === environmentKey) return;
  telemetryReportedKey = environmentKey;
  const detail: RendererTelemetryEvent = {
    preferredBackend: result.preferredBackend,
    triedWebGPU: result.triedWebGPU,
    fallbackReason: result.fallbackReason,
    isWebGPUSupported: result.preferredBackend === 'webgpu',
  };
  telemetryHandler?.('renderer_capabilities', detail);
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(
      new CustomEvent('stims:renderer-capabilities', { detail }),
    );
  }
};

const cacheResult = (result: RendererCapabilities) => {
  cachedCapabilities = result;
  reportRendererTelemetry(result);
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
  telemetryReportedKey = null;
}

export function getRenderingSupport(): RenderingSupport {
  const hasWebGPU =
    typeof navigator !== 'undefined' &&
    Boolean((navigator as Navigator & { gpu?: GPU }).gpu);
  const hasWebGL =
    typeof WebGL !== 'undefined' &&
    (WebGL as { isWebGLAvailable?: () => boolean }).isWebGLAvailable?.();

  return {
    hasWebGPU,
    hasWebGL: Boolean(hasWebGL),
  };
}

async function probeRendererCapabilities(): Promise<RendererCapabilities> {
  if (typeof navigator === 'undefined') {
    return cacheResult(buildFallback('Renderer capabilities are unavailable.'));
  }

  if (isCompatibilityModeEnabled()) {
    return cacheResult(
      buildFallback('Compatibility mode is enabled. Using WebGL.', {
        triedWebGPU: false,
        shouldRetryWebGPU: false,
      }),
    );
  }
  const { gpu } = navigator as Navigator & { gpu?: GPU };
  if (!gpu?.requestAdapter) {
    return cacheResult(
      buildFallback('WebGPU is not available in this browser.', {
        triedWebGPU: false,
        shouldRetryWebGPU: false,
      }),
    );
  }

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return cacheResult(
        buildFallback('No compatible WebGPU adapter was found.', {
          triedWebGPU: true,
          shouldRetryWebGPU: true,
        }),
      );
    }

    let device: GPUDevice | null = null;
    try {
      device = await adapter.requestDevice();
    } catch (error) {
      console.warn(
        'WebGPU device request failed. Falling back to WebGL.',
        error,
      );
      return cacheResult(
        buildFallback('Unable to acquire a WebGPU device.', {
          triedWebGPU: true,
          shouldRetryWebGPU: true,
        }),
      );
    }

    if (!device) {
      return cacheResult(
        buildFallback('WebGPU device request returned no device.', {
          triedWebGPU: true,
          shouldRetryWebGPU: true,
        }),
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
      }),
    );
  }
}

export function resetRendererCapabilities() {
  resetCache();
  cachedEnvironmentKey = null;
}

export function setRendererTelemetryHandler(
  handler: RendererTelemetryHandler | null,
) {
  telemetryHandler = handler;
}

export function rememberRendererFallback(
  fallbackReason: string,
  {
    shouldRetryWebGPU = false,
    triedWebGPU = true,
  }: { shouldRetryWebGPU?: boolean; triedWebGPU?: boolean } = {},
) {
  cachedEnvironmentKey = getEnvironmentKey();
  const result = cacheResult(
    buildFallback(fallbackReason, {
      triedWebGPU,
      shouldRetryWebGPU,
    }),
  );
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

export function getCachedRendererCapabilities() {
  return cachedCapabilities;
}
