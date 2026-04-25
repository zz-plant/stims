/* global GPUAdapter, GPUDevice, GPU */

import WebGL from 'three/examples/jsm/capabilities/WebGL.js';
import {
  getDeviceEnvironmentProfile,
  isMobileDevice,
} from '../utils/device-detect.ts';
import { isCompatibilityModeEnabled } from './render-preferences.ts';
import {
  getRendererFallbackReasonMessage,
  inferRendererFallbackReasonCode,
  RENDERER_FALLBACK_REASON_CODES,
  type RendererFallbackReasonCode,
} from './renderer-fallback-reasons.ts';
import {
  DEFAULT_WEBGPU_INIT_TIMEOUT_MS,
  resolveWithTimeout,
} from './renderer-init-timeout.ts';

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

export type RendererOptimizationSupport = {
  timestampQuery: boolean;
  shaderF16: boolean;
  subgroups: boolean;
  workers: boolean;
  offscreenCanvas: boolean;
  transferControlToOffscreen: boolean;
  workerOffscreenPipeline: boolean;
};

export type WebGPUCapabilitySummary = {
  features: WebGPUFeatureSupport;
  limits: WebGPULimitSnapshot;
  workers: WebGPUWorkerSupport;
  optimization: RendererOptimizationSupport;
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

export type KnownOptimizationTelemetryCounter =
  | 'renderScaleOverride'
  | 'feedbackScaleOverride'
  | 'meshDensityOverride'
  | 'waveSampleOverride'
  | 'motionVectorDensityOverride'
  | 'timestampQueryUsage'
  | 'shaderF16Usage'
  | 'subgroupsUsage'
  | 'workerOffscreenUsage';

export type RendererOptimizationTelemetryCounterName =
  | KnownOptimizationTelemetryCounter
  | (string & {});

export type RendererOptimizationTelemetryDetail = {
  counter: RendererOptimizationTelemetryCounterName;
  amount?: number;
};

type FallbackOptions = {
  shouldRetryWebGPU?: boolean;
  backend?: RendererBackend | null;
  forceWebGL?: boolean;
};

type RendererCapabilityProbeOptions = {
  forceRetry?: boolean;
  preferWebGLForKnownCompatibilityGaps?: boolean;
  webgpuInitTimeoutMs?: number;
};

let capabilitiesPromise: Promise<RendererCapabilities> | null = null;
let cachedCapabilities: RendererCapabilities | null = null;
let cachedEnvironmentKey: unknown = null;
let telemetryHandler: RendererTelemetryHandler | null = null;
let telemetryReportedKey: unknown = null;
const observedCapabilityDevices = new WeakSet<GPUDevice>();

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

function getEnvironmentKey({
  preferWebGLForKnownCompatibilityGaps = false,
}: {
  preferWebGLForKnownCompatibilityGaps?: boolean;
} = {}) {
  if (typeof navigator === 'undefined') return 'no-navigator';
  const nav = navigator as Navigator & { gpu?: GPU; userAgent?: string };
  const hasGpu = Boolean(nav.gpu);
  const userAgent = nav.userAgent ?? '';
  const compatibilityMode = isCompatibilityModeEnabled()
    ? 'compat-on'
    : 'compat-off';
  const webgpuCompatibilityMode = preferWebGLForKnownCompatibilityGaps
    ? 'webgpu-gap-guard-on'
    : 'webgpu-gap-guard-off';
  return `${hasGpu}:${userAgent}:${compatibilityMode}:${webgpuCompatibilityMode}`;
}

function isGuardedMobileWebGPUEnvironment() {
  if (typeof navigator === 'undefined' || !isMobileDevice()) {
    return false;
  }

  const hasWebGPU =
    Boolean((navigator as Navigator & { gpu?: GPU }).gpu) &&
    typeof (navigator as Navigator & { gpu?: GPU }).gpu?.requestAdapter ===
      'function';

  if (!hasWebGPU) {
    const userAgent = navigator.userAgent?.toLowerCase() ?? '';
    return (
      userAgent.includes('samsungbrowser/') ||
      userAgent.includes('; wv') ||
      userAgent.includes('miuibrowser/')
    );
  }

  return false;
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

function isFallbackAdapter(adapter: GPUAdapter | null | undefined) {
  return Boolean(
    (
      adapter as GPUAdapter & {
        isFallbackAdapter?: boolean;
      }
    )?.isFallbackAdapter,
  );
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

export function summarizeRendererOptimizationSupport({
  features,
  workers,
}: {
  features: Pick<
    WebGPUFeatureSupport,
    'timestampQuery' | 'shaderF16' | 'subgroups'
  >;
  workers: WebGPUWorkerSupport;
}): RendererOptimizationSupport {
  return {
    timestampQuery: features.timestampQuery,
    shaderF16: features.shaderF16,
    subgroups: features.subgroups,
    workers: workers.workers,
    offscreenCanvas: workers.offscreenCanvas,
    transferControlToOffscreen: workers.transferControlToOffscreen,
    workerOffscreenPipeline:
      workers.workers &&
      workers.offscreenCanvas &&
      workers.transferControlToOffscreen,
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
  const environment = getDeviceEnvironmentProfile();
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

  const workers = getWorkerSupport();
  const performanceTier = getWebGPUPerformanceTier({ features, limits });

  return {
    features,
    limits,
    workers,
    optimization: summarizeRendererOptimizationSupport({ features, workers }),
    preferredCanvasFormat: getPreferredCanvasFormat(),
    performanceTier,
    recommendedQualityPreset: environment.isMobile
      ? 'balanced'
      : performanceTier === 'high-end'
        ? 'hi-fi'
        : 'balanced',
  } satisfies WebGPUCapabilitySummary;
}

function describeCapabilityDeviceLoss(info: unknown) {
  const reason =
    info &&
    typeof info === 'object' &&
    'reason' in info &&
    typeof info.reason === 'string'
      ? info.reason
      : 'unknown';
  const message =
    info &&
    typeof info === 'object' &&
    'message' in info &&
    typeof info.message === 'string' &&
    info.message.trim().length > 0
      ? info.message.trim()
      : null;
  const detail = message ? `${reason}: ${message}` : reason;
  return `WebGPU device was lost (${detail}).`;
}

function observeCapabilityDevice(device: GPUDevice) {
  if (observedCapabilityDevices.has(device)) {
    return;
  }
  observedCapabilityDevices.add(device);
  void device.lost
    ?.then((info) => {
      observedCapabilityDevices.delete(device);
      const message = describeCapabilityDeviceLoss(info);
      console.warn(message);
      rememberRendererFallback(message, {
        backend: getFallbackBackend(),
        shouldRetryWebGPU: true,
      });
    })
    .catch(() => {
      observedCapabilityDevices.delete(device);
    });
}

export function getRendererOptimizationSupport(
  capabilities: RendererCapabilities | null | undefined,
): RendererOptimizationSupport {
  if (capabilities?.webgpu) {
    return capabilities.webgpu.optimization;
  }

  return {
    timestampQuery: false,
    shaderF16: false,
    subgroups: false,
    workers: false,
    offscreenCanvas: false,
    transferControlToOffscreen: false,
    workerOffscreenPipeline: false,
  };
}

export function recordRendererOptimizationTelemetry(
  detail: RendererOptimizationTelemetryDetail,
) {
  if (typeof window === 'undefined' || !window.dispatchEvent) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent('stims:renderer-optimization-telemetry', {
      detail: {
        amount: 1,
        ...detail,
      } satisfies RendererOptimizationTelemetryDetail,
    }),
  );
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

async function probeRendererCapabilities({
  preferWebGLForKnownCompatibilityGaps = false,
  webgpuInitTimeoutMs = DEFAULT_WEBGPU_INIT_TIMEOUT_MS,
}: {
  preferWebGLForKnownCompatibilityGaps?: boolean;
  webgpuInitTimeoutMs?: number;
} = {}): Promise<RendererCapabilities> {
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

  if (isGuardedMobileWebGPUEnvironment()) {
    return cacheResult(
      buildFallback(
        'WebGPU is temporarily disabled on this mobile browser while we stabilize renderer compatibility. Using WebGL mode.',
        { forceWebGL: true },
      ),
    );
  }

  if (preferWebGLForKnownCompatibilityGaps) {
    return cacheResult(
      buildFallback(
        'WebGPU is temporarily disabled for the live visualizer while we stabilize ShaderMaterial compatibility. Using WebGL mode.',
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

    if (isFallbackAdapter(adapter)) {
      return cacheResult(
        buildFallback(
          getRendererFallbackReasonMessage(
            RENDERER_FALLBACK_REASON_CODES.fallbackAdapter,
          ),
        ),
      );
    }

    let device: GPUDevice | null = null;
    try {
      device = await resolveWithTimeout(
        adapter.requestDevice(),
        webgpuInitTimeoutMs,
        'WebGPU device initialization timed out.',
      );
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

    observeCapabilityDevice(device);

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

export async function getRendererCapabilities({
  forceRetry = false,
  preferWebGLForKnownCompatibilityGaps = false,
  webgpuInitTimeoutMs = DEFAULT_WEBGPU_INIT_TIMEOUT_MS,
}: RendererCapabilityProbeOptions = {}) {
  const environmentKey = getEnvironmentKey({
    preferWebGLForKnownCompatibilityGaps,
  });
  const environmentChanged = environmentKey !== cachedEnvironmentKey;

  if (forceRetry || environmentChanged) {
    resetCache();
  }

  cachedEnvironmentKey = environmentKey;

  if (!capabilitiesPromise) {
    capabilitiesPromise = probeRendererCapabilities({
      preferWebGLForKnownCompatibilityGaps,
      webgpuInitTimeoutMs,
    });
  }

  return capabilitiesPromise;
}

export function getCachedRendererCapabilities() {
  return cachedCapabilities;
}
