import type * as THREE from 'three';
import {
  getDeviceEnvironmentProfile,
  isMobileDevice,
} from '../utils/browser/device-detect';
import {
  getAdaptiveMaxPixelRatio,
  getDevicePerformanceProfile,
} from './device-profile.ts';
import { DEFAULT_WEBGPU_INIT_TIMEOUT_MS } from './renderer-init-timeout.ts';
import type {
  RendererInitConfig,
  RendererInitResult,
} from './renderer-setup.ts';
import type { WebGPURenderer } from './webgpu-renderer.ts';

const appliedRendererDimensions = new WeakMap<
  object,
  { pixelRatio: number; width: number; height: number }
>();

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
    const isLowPower = getDevicePerformanceProfile().lowPower;
    if (
      browserFamily === 'safari' ||
      browserFamily === 'chrome' ||
      browserFamily === 'edge' ||
      browserFamily === 'samsung-internet' ||
      platformFamily === 'ios' ||
      platformFamily === 'android'
    ) {
      if (isLowPower) {
        return backend === 'webgpu' ? 1.2 : 1.0;
      }
      // Measured on a Galaxy S22 (WebGPU, 'enhanced' tier): the old 1.2 cap
      // rendered at ~43% of native and left over half the 60Hz frame budget
      // idle. Capable phones get a higher ceiling; the adaptive controller
      // still walks quality down if the device can't sustain it.
      return backend === 'webgpu' ? 2.0 : 1.2;
    }

    if (isLowPower) {
      return backend === 'webgpu' ? 1.2 : 1.0;
    }
    return 2.0;
  }

  const isLowPower = getDevicePerformanceProfile().lowPower;
  return backend === 'webgpu' ? 4 : isLowPower ? 1.75 : 2.5;
}

export function getConstrainedTextureDimensionCap(): number {
  const profile = getDevicePerformanceProfile();
  if (profile.lowPower) {
    return 2048;
  }
  return 8192;
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
  preserveDrawingBuffer: false,
};

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
  // Precedence Chain for settings resolution:
  // 1. Explicit overrides passed via `options`.
  // 2. User advanced overrides (RenderPreferences) -> resolved in `defaults`.
  // 3. Quality presets (active settings) -> fallback in `defaults`.
  // 4. Runtime adaptive adjustments (adaptive multipliers) -> dynamically applied.
  // 5. Hardware/Platform/Browser constraints (backend caps) -> absolute boundaries.
  const merged = resolveRendererSettings(options, info, defaults);
  const effectiveRenderScale = Math.max(
    0.4,
    (merged.renderScale ?? 1) * (merged.adaptiveRenderScaleMultiplier ?? 1),
  );
  const currentDeviceEnv = getDeviceEnvironmentProfile();
  const backendPixelRatioCap = getRendererBackendMaxPixelRatioCap({
    backend: info.backend,
    isMobile: isMobileDevice(),
    browserFamily: currentDeviceEnv.browserFamily,
    platformFamily: currentDeviceEnv.platformFamily,
  });
  // getAdaptiveMaxPixelRatio clamps low-power hardware to 1.25; renderer
  // init applies it, and omitting it here let the first resize silently
  // raise a low-power desktop back to the 1.75-4x backend cap.
  const effectiveMaxPixelRatio = Math.max(
    0.5,
    Math.min(
      getAdaptiveMaxPixelRatio(merged.maxPixelRatio ?? 2) *
        (merged.adaptiveMaxPixelRatioMultiplier ?? 1),
      backendPixelRatioCap,
    ),
  );
  const effectivePixelRatio = Math.min(
    (window.devicePixelRatio || 1) * effectiveRenderScale,
    effectiveMaxPixelRatio,
  );
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  const previousDimensions = appliedRendererDimensions.get(renderer);

  if (
    !previousDimensions ||
    previousDimensions.pixelRatio !== effectivePixelRatio ||
    previousDimensions.width !== width ||
    previousDimensions.height !== height
  ) {
    if (
      info.backend === 'webgpu' &&
      typeof renderer.setDrawingBufferSize === 'function'
    ) {
      // WebGPURenderer rebuilds its default color/depth attachments on every
      // resize event. Updating pixel ratio and size separately emits two
      // events with different dimensions, so a frame between them can pair a
      // stale depth attachment with the newly sized canvas attachment.
      renderer.setDrawingBufferSize(width, height, effectivePixelRatio);
    } else {
      renderer.setPixelRatio(effectivePixelRatio);
      renderer.setSize(width, height, false);
    }
    appliedRendererDimensions.set(renderer, {
      pixelRatio: effectivePixelRatio,
      width,
      height,
    });
  }
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
