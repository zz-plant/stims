import type * as THREE from 'three';
import type {
  RendererInitConfig,
  RendererInitResult,
} from './renderer-setup.ts';
import type { WebGPURenderer } from './webgpu-renderer.ts';

export type RendererViewport = {
  width: number;
  height: number;
};

const BASE_RENDERER_SETTINGS: Required<RendererInitConfig> = {
  maxPixelRatio: 2,
  renderScale: 1,
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
