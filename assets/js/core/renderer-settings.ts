import type * as THREE from 'three';
import {
  getDeviceEnvironmentProfile,
  isMobileDevice,
} from '../utils/device-detect';
import { DEFAULT_WEBGPU_INIT_TIMEOUT_MS } from './renderer-init-timeout.ts';
import type {
  RendererInitConfig,
  RendererInitResult,
} from './renderer-setup.ts';
import type { WebGPURenderer } from './webgpu-renderer.ts';

const isMobileUserAgent = isMobileDevice();

export function getRendererBackendMaxPixelRatioCap({
  backend,
  isMobile,
  browserFamily = 'other',
  platformFamily = 'other',
}: {
  backend: 'webgl' | 'webgpu';
  isMobile: boolean;
  browserFamily?:
    | 'chrome'
    | 'edge'
    | 'firefox'
    | 'safari'
    | 'samsung-internet'
    | 'other';
  platformFamily?: 'android' | 'ios' | 'linux' | 'macos' | 'windows' | 'other';
}) {
  if (isMobile) {
    if (platformFamily === 'ios' && browserFamily === 'safari') {
      return backend === 'webgpu' ? 1.4 : 1.15;
    }

    if (
      platformFamily === 'android' ||
      browserFamily === 'chrome' ||
      browserFamily === 'edge' ||
      browserFamily === 'samsung-internet'
    ) {
      return backend === 'webgpu' ? 1.35 : 1.1;
    }

    return backend === 'webgpu' ? 1.4 : 1.15;
  }

  return backend === 'webgpu' ? 2 : 1.35;
}

export type RendererViewport = {
  width: number;
  height: number;
};

export type RendererRuntimeControls = {
  renderScale: number;
  feedbackScale: number;
  meshDensityMultiplier: number;
  waveSampleMultiplier: number;
  motionVectorDensityMultiplier: number;
};

export type RendererRuntimeControlOverrides =
  Partial<RendererRuntimeControls> | null;

const BASE_RENDERER_SETTINGS: Required<RendererInitConfig> = {
  maxPixelRatio: 1.5,
  renderScale: 1,
  adaptiveMaxPixelRatioMultiplier: 1,
  adaptiveRenderScaleMultiplier: 1,
  adaptiveDensityMultiplier: 1,
  exposure: 1,
  antialias: true,
  alpha: false,
  webgpuInitTimeoutMs: DEFAULT_WEBGPU_INIT_TIMEOUT_MS,
  forceRetryCapabilities: false,
};
const deviceEnvironment = getDeviceEnvironmentProfile();

export const DEFAULT_RENDERER_RUNTIME_CONTROLS: RendererRuntimeControls = {
  renderScale: 1,
  feedbackScale: 1,
  meshDensityMultiplier: 1,
  waveSampleMultiplier: 1,
  motionVectorDensityMultiplier: 1,
};

function normalizeRuntimeControlValue(
  value: number | undefined,
  fallback: number,
) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export function resolveRendererRuntimeControls(
  overrides: RendererRuntimeControlOverrides = null,
  defaults: RendererRuntimeControls = DEFAULT_RENDERER_RUNTIME_CONTROLS,
): RendererRuntimeControls {
  return {
    renderScale: normalizeRuntimeControlValue(
      overrides?.renderScale,
      defaults.renderScale,
    ),
    feedbackScale: normalizeRuntimeControlValue(
      overrides?.feedbackScale,
      defaults.feedbackScale,
    ),
    meshDensityMultiplier: normalizeRuntimeControlValue(
      overrides?.meshDensityMultiplier,
      defaults.meshDensityMultiplier,
    ),
    waveSampleMultiplier: normalizeRuntimeControlValue(
      overrides?.waveSampleMultiplier,
      defaults.waveSampleMultiplier,
    ),
    motionVectorDensityMultiplier: normalizeRuntimeControlValue(
      overrides?.motionVectorDensityMultiplier,
      defaults.motionVectorDensityMultiplier,
    ),
  };
}

export function resolveRendererSettings(
  options: Partial<RendererInitConfig> = {},
  info?: RendererInitResult | null,
  defaults: Partial<RendererInitConfig> = {},
): RendererInitConfig {
  return {
    maxPixelRatio:
      options.maxPixelRatio ??
      defaults.maxPixelRatio ??
      info?.maxPixelRatio ??
      BASE_RENDERER_SETTINGS.maxPixelRatio,
    renderScale:
      options.renderScale ??
      defaults.renderScale ??
      info?.renderScale ??
      BASE_RENDERER_SETTINGS.renderScale,
    adaptiveMaxPixelRatioMultiplier:
      options.adaptiveMaxPixelRatioMultiplier ??
      info?.adaptiveMaxPixelRatioMultiplier ??
      defaults.adaptiveMaxPixelRatioMultiplier ??
      BASE_RENDERER_SETTINGS.adaptiveMaxPixelRatioMultiplier,
    adaptiveRenderScaleMultiplier:
      options.adaptiveRenderScaleMultiplier ??
      info?.adaptiveRenderScaleMultiplier ??
      defaults.adaptiveRenderScaleMultiplier ??
      BASE_RENDERER_SETTINGS.adaptiveRenderScaleMultiplier,
    adaptiveDensityMultiplier:
      options.adaptiveDensityMultiplier ??
      info?.adaptiveDensityMultiplier ??
      defaults.adaptiveDensityMultiplier ??
      BASE_RENDERER_SETTINGS.adaptiveDensityMultiplier,
    exposure:
      options.exposure ??
      defaults.exposure ??
      info?.exposure ??
      BASE_RENDERER_SETTINGS.exposure,
    antialias:
      options.antialias ??
      defaults.antialias ??
      BASE_RENDERER_SETTINGS.antialias,
    alpha: options.alpha ?? defaults.alpha ?? BASE_RENDERER_SETTINGS.alpha,
    webgpuInitTimeoutMs:
      options.webgpuInitTimeoutMs ??
      defaults.webgpuInitTimeoutMs ??
      BASE_RENDERER_SETTINGS.webgpuInitTimeoutMs,
    forceRetryCapabilities:
      options.forceRetryCapabilities ??
      defaults.forceRetryCapabilities ??
      BASE_RENDERER_SETTINGS.forceRetryCapabilities,
  };
}

export function applyRendererSettings(
  renderer: THREE.WebGLRenderer | WebGPURenderer,
  info: RendererInitResult,
  options: Partial<RendererInitConfig> = {},
  defaults: Partial<RendererInitConfig> = {},
  viewport?: RendererViewport,
) {
  const merged = resolveRendererSettings(options, info, defaults);
  const effectiveRenderScale = Math.max(
    0.4,
    (merged.renderScale ?? 1) * (merged.adaptiveRenderScaleMultiplier ?? 1),
  );
  const backendPixelRatioCap = getRendererBackendMaxPixelRatioCap({
    backend: info.backend,
    isMobile: isMobileUserAgent,
    browserFamily: deviceEnvironment.browserFamily,
    platformFamily: deviceEnvironment.platformFamily,
  });
  const effectiveMaxPixelRatio = Math.max(
    0.5,
    Math.min(
      (merged.maxPixelRatio ?? 2) *
        (merged.adaptiveMaxPixelRatioMultiplier ?? 1),
      backendPixelRatioCap,
    ),
  );
  const effectivePixelRatio = Math.min(
    (window.devicePixelRatio || 1) * effectiveRenderScale,
    effectiveMaxPixelRatio,
  );

  renderer.setPixelRatio(effectivePixelRatio);
  renderer.setSize(
    viewport?.width ?? window.innerWidth,
    viewport?.height ?? window.innerHeight,
    false,
  );
  renderer.toneMappingExposure = merged.exposure ?? 1;

  info.maxPixelRatio = merged.maxPixelRatio ?? info.maxPixelRatio;
  info.renderScale = merged.renderScale ?? info.renderScale;
  info.adaptiveMaxPixelRatioMultiplier =
    merged.adaptiveMaxPixelRatioMultiplier ??
    info.adaptiveMaxPixelRatioMultiplier;
  info.adaptiveRenderScaleMultiplier =
    merged.adaptiveRenderScaleMultiplier ?? info.adaptiveRenderScaleMultiplier;
  info.adaptiveDensityMultiplier =
    merged.adaptiveDensityMultiplier ?? info.adaptiveDensityMultiplier;
  info.exposure = merged.exposure ?? info.exposure;
}
