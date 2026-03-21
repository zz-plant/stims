import type * as THREE from 'three';
import type {
  RendererInitConfig,
  RendererInitResult,
} from './renderer-setup.ts';
import type { WebGPURenderer } from './webgpu-renderer.ts';

export function getRendererBackendMaxPixelRatioCap({
  backend,
  isMobile,
}: {
  backend: 'webgl' | 'webgpu';
  isMobile: boolean;
}) {
  if (isMobile) {
    return backend === 'webgpu' ? 1.5 : 1.25;
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
  exposure: 1,
  antialias: true,
  alpha: false,
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
  const effectivePixelRatio = Math.min(
    (window.devicePixelRatio || 1) * (merged.renderScale ?? 1),
    merged.maxPixelRatio ?? 2,
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
  info.exposure = merged.exposure ?? info.exposure;
}
