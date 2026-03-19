/* global GPUAdapter, GPUDevice, GPU */

import WebGL from 'three/examples/jsm/capabilities/WebGL.js';

import { isCompatibilityModeEnabled } from './render-preferences.ts';
import {
  getRendererFallbackReasonMessage,
  inferRendererFallbackReasonCode,
  RENDERER_FALLBACK_REASON_CODES,
  type RendererFallbackReasonCode,
} from './renderer-fallback-reasons.ts';

export type RendererBackend = 'webgl' | 'webgpu';

export type WebGPUCapabilityTier = 'baseline' | 'enhanced' | 'high-end';

export type WebGPUFeatureSupport = {
  bgra8unormStorage: boolean;
  float32Blendable: boolean;
  float32Filterable: boolean;
  shaderF16: boolean;
  subgroups: boolean;
  timestampQuery: boolean;
};

export type WebGPULimitSnapshot = {
  maxColorAttachments: number | null;
  maxComputeInvocationsPerWorkgroup: number | null;
  maxStorageBufferBindingSize: number | null;
  maxTextureDimension2D: number | null;
};

export type WebGPUWorkerSupport = {
  workers: boolean;
  offscreenCanvas: boolean;
  transferControlToOffscreen: boolean;
};

export type WebGPUCapabilitySummary = {
  features: WebGPUFeatureSupport;
  limits: WebGPULimitSnapshot;
  workers: WebGPUWorkerSupport;
  preferredCanvasFormat: string | null;
  performanceTier: WebGPUCapabilityTier;
  recommendedQualityPreset: 'balanced' | 'hi-fi';
};

export type RendererCapabilities = {
  preferredBackend: RendererBackend | null;
  adapter: GPUAdapter | null;
  device: GPUDevice | null;
  fallbackReason: string | null;
  fallbackReasonCode: RendererFallbackReasonCode | null;
  shouldRetryWebGPU: boolean;
  forceWebGL: boolean;
  webgpu: WebGPUCapabilitySummary | null;
};

export type RendererTelemetryEvent = {
  preferredBackend: RendererBackend | null;
  fallbackReason: string | null;
  fallbackReasonCode: RendererFallbackReasonCode | null;
  isWebGPUSupported: boolean;
  forceWebGL: boolean;
  webgpu: WebGPUCapabilitySummary | null;
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
  shouldRetryWebGPU?: boolean;
  backend?: RendererBackend | null;
  forceWebGL?: boolean;
};

let capabilitiesPromise: Promise<RendererCapabilities> | null = null;
let cachedCapabilities: RendererCapabilities | null = null;
let cachedEnvironmentKey: unknown = null;
let telemetryHandler: RendererTelemetryHandler | null = null;
let telemetryReportedKey: unknown = null;

const buildFallback = (
  fallbackReason: string,
  {
    shouldRetryWebGPU = false,
    backend = getFallbackBackend(),
    forceWebGL = false,
  }: FallbackOptions = {},
): RendererCapabilities => ({
  preferredBackend: backend,
  adapter: null,
  device: null,
  fallbackReason,
  fallbackReasonCode: inferRendererFallbackReasonCode(fallbackReason),
  shouldRetryWebGPU,
  forceWebGL,
  webgpu: null,
});

const reportRendererTelemetry = (result: RendererCapabilities) => {
  const environmentKey = cachedEnvironmentKey ?? getEnvironmentKey();
  if (telemetryReportedKey === environmentKey) return;
  telemetryReportedKey = environmentKey;
  const detail: RendererTelemetryEvent = {
    preferredBackend: result.preferredBackend,
    fallbackReason: result.fallbackReason,
    fallbackReasonCode: result.fallbackReasonCode,
    isWebGPUSupported: result.preferredBackend === 'webgpu',
    forceWebGL: result.forceWebGL,
    webgpu: result.webgpu,
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

function getFallbackBackend(): RendererBackend | null {
  return getRenderingSupport().hasWebGL ? 'webgl' : null;
}

function probeCanvasWebGLContext() {
  if (typeof document === 'undefined') {
    return false;
  }

  try {
    const canvas = document.createElement('canvas');
    if (typeof canvas.getContext !== 'function') {
      return false;
    }
    return Boolean(
      canvas.getContext('webgl') || canvas.getContext('experimental-webgl'),
    );
  } catch (_error) {
    return false;
  }
}

function hasFeature(
  features: GPUSupportedFeatures | Set<string> | undefined,
  name: string,
) {
  return Boolean(features && 'has' in features && features.has(name));
}

function getNumericLimit(
  limits: GPUSupportedLimits | Record<string, unknown> | undefined,
  key: keyof WebGPULimitSnapshot,
) {
  const value = limits?.[key];
  return typeof value === 'number' ? value : null;
}

function getPreferredCanvasFormat() {
  if (typeof navigator === 'undefined') {
    return null;
  }

  const gpuNavigator = navigator as Navigator & {
    gpu?: GPU & { getPreferredCanvasFormat?: () => string };
  };
  return gpuNavigator.gpu?.getPreferredCanvasFormat?.() ?? null;
}

function getWorkerSupport(): WebGPUWorkerSupport {
  const transferControlToOffscreen =
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype?.transferControlToOffscreen ===
      'function';

  return {
    workers: typeof Worker !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    transferControlToOffscreen,
  };
}

function getWebGPUPerformanceTier({
  features,
  limits,
}: {
  features: WebGPUFeatureSupport;
  limits: WebGPULimitSnapshot;
}): WebGPUCapabilityTier {
  const hasLargeStorageBuffer =
    (limits.maxStorageBufferBindingSize ?? 0) >= 1_073_741_824;
  const hasStrongComputeBudget =
    (limits.maxComputeInvocationsPerWorkgroup ?? 0) >= 512;
  const hasMultiPassHeadroom = (limits.maxColorAttachments ?? 0) >= 8;

  if (
    features.shaderF16 &&
    features.subgroups &&
    features.timestampQuery &&
    features.float32Blendable &&
    hasLargeStorageBuffer &&
    hasStrongComputeBudget &&
    hasMultiPassHeadroom
  ) {
    return 'high-end';
  }

  if (
    features.shaderF16 ||
    features.timestampQuery ||
    features.float32Blendable ||
    features.float32Filterable
  ) {
    return 'enhanced';
  }

  return 'baseline';
}

function summarizeWebGPUCapabilities(adapter: GPUAdapter) {
  const features: WebGPUFeatureSupport = {
    bgra8unormStorage: hasFeature(adapter.features, 'bgra8unorm-storage'),
    float32Blendable: hasFeature(adapter.features, 'float32-blendable'),
    float32Filterable: hasFeature(adapter.features, 'float32-filterable'),
    shaderF16: hasFeature(adapter.features, 'shader-f16'),
    subgroups: hasFeature(adapter.features, 'subgroups'),
    timestampQuery: hasFeature(adapter.features, 'timestamp-query'),
  };

  const limits: WebGPULimitSnapshot = {
    maxColorAttachments: getNumericLimit(adapter.limits, 'maxColorAttachments'),
    maxComputeInvocationsPerWorkgroup: getNumericLimit(
      adapter.limits,
      'maxComputeInvocationsPerWorkgroup',
    ),
    maxStorageBufferBindingSize: getNumericLimit(
      adapter.limits,
      'maxStorageBufferBindingSize',
    ),
    maxTextureDimension2D: getNumericLimit(
      adapter.limits,
      'maxTextureDimension2D',
    ),
  };

  const performanceTier = getWebGPUPerformanceTier({ features, limits });

  return {
    features,
    limits,
    workers: getWorkerSupport(),
    preferredCanvasFormat: getPreferredCanvasFormat(),
    performanceTier,
    recommendedQualityPreset:
      performanceTier === 'high-end' ? 'hi-fi' : 'balanced',
  } satisfies WebGPUCapabilitySummary;
}

export function getRenderingSupport(): RenderingSupport {
  const hasWebGPU =
    typeof navigator !== 'undefined' &&
    Boolean((navigator as Navigator & { gpu?: GPU }).gpu);
  const libraryWebGLSupport =
    typeof WebGL !== 'undefined' &&
    (WebGL as { isWebGLAvailable?: () => boolean }).isWebGLAvailable?.();
  const hasWebGL = Boolean(libraryWebGLSupport) || probeCanvasWebGLContext();

  return {
    hasWebGPU,
    hasWebGL: Boolean(hasWebGL),
  };
}

async function probeRendererCapabilities(): Promise<RendererCapabilities> {
  if (typeof navigator === 'undefined') {
    return cacheResult(
      buildFallback(
        getRendererFallbackReasonMessage(
          RENDERER_FALLBACK_REASON_CODES.rendererUnavailable,
        ),
      ),
    );
  }

  if (isCompatibilityModeEnabled()) {
    return cacheResult(
      buildFallback(
        getRendererFallbackReasonMessage(
          RENDERER_FALLBACK_REASON_CODES.compatibilityMode,
        ),
        { forceWebGL: true },
      ),
    );
  }

  const { gpu } = navigator as Navigator & { gpu?: GPU };
  if (!gpu?.requestAdapter) {
    return cacheResult(
      buildFallback(
        getRendererFallbackReasonMessage(
          RENDERER_FALLBACK_REASON_CODES.webgpuUnavailable,
        ),
      ),
    );
  }

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return cacheResult(
        buildFallback(
          getRendererFallbackReasonMessage(
            RENDERER_FALLBACK_REASON_CODES.noAdapter,
          ),
          {
            shouldRetryWebGPU: true,
          },
        ),
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
        buildFallback(
          getRendererFallbackReasonMessage(
            RENDERER_FALLBACK_REASON_CODES.noDevice,
          ),
          {
            shouldRetryWebGPU: true,
          },
        ),
      );
    }

    if (!device) {
      return cacheResult(
        buildFallback('WebGPU device request returned no device.', {
          shouldRetryWebGPU: true,
        }),
      );
    }

    return cacheResult({
      preferredBackend: 'webgpu',
      adapter,
      device,
      fallbackReason: null,
      fallbackReasonCode: null,
      shouldRetryWebGPU: false,
      forceWebGL: false,
      webgpu: summarizeWebGPUCapabilities(adapter),
    });
  } catch (error) {
    console.warn('WebGPU initialization failed. Falling back to WebGL.', error);
    return cacheResult(
      buildFallback(
        getRendererFallbackReasonMessage(
          RENDERER_FALLBACK_REASON_CODES.webgpuInitFailed,
        ),
        {
          shouldRetryWebGPU: true,
        },
      ),
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
    fallbackReasonCode,
    backend,
    forceWebGL = false,
  }: {
    shouldRetryWebGPU?: boolean;
    fallbackReasonCode?: RendererFallbackReasonCode;
    backend?: RendererBackend | null;
    forceWebGL?: boolean;
  } = {},
) {
  cachedEnvironmentKey = getEnvironmentKey();
  const resolvedFallbackReason =
    fallbackReasonCode && !fallbackReason
      ? getRendererFallbackReasonMessage(fallbackReasonCode)
      : fallbackReason;
  const result = cacheResult({
    ...buildFallback(resolvedFallbackReason, {
      shouldRetryWebGPU,
      backend,
      forceWebGL,
    }),
    fallbackReasonCode:
      fallbackReasonCode ??
      inferRendererFallbackReasonCode(resolvedFallbackReason),
    webgpu: cachedCapabilities?.webgpu ?? null,
  });
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
