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

const BASE_RENDERER_SETTINGS: Required<RendererInitConfig> = {
  maxPixelRatio: 1.5,
  renderScale: 1,
  adaptiveMaxPixelRatioMultiplier: 1,
  adaptiveRenderScaleMultiplier: 1,
  adaptiveDensityMultiplier: 1,
  exposure: 1,
  antialias: true,
  alpha: false,
};

export function resolveRendererSettings(
  options: Partial<RendererInitConfig> = {},
  info?: RendererInitResult | null,
  defaults: Partial<RendererInitConfig> = {},
): RendererInitConfig {
  return {
    maxPixelRatio:
      options.maxPixelRatio ??
      info?.maxPixelRatio ??
      defaults.maxPixelRatio ??
      BASE_RENDERER_SETTINGS.maxPixelRatio,
    renderScale:
      options.renderScale ??
      info?.renderScale ??
      defaults.renderScale ??
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
      info?.exposure ??
      defaults.exposure ??
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
  const effectiveRenderScale = Math.max(
    0.4,
    (merged.renderScale ?? 1) * (merged.adaptiveRenderScaleMultiplier ?? 1),
  );
  const effectiveMaxPixelRatio = Math.max(
    0.5,
    (merged.maxPixelRatio ?? 2) * (merged.adaptiveMaxPixelRatioMultiplier ?? 1),
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
