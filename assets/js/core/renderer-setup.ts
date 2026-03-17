/* global GPUAdapter, GPUDevice */
import {
  ACESFilmicToneMapping,
  SRGBColorSpace,
  type WebGLRenderer,
} from 'three';
import { isMobileDevice } from '../utils/device-detect';
import { ensureWebGL } from '../utils/webgl-check';
import { createWebGLRenderer } from '../utils/webgl-renderer';
import { getAdaptiveMaxPixelRatio } from './device-profile.ts';
import {
  getRendererCapabilities,
  type RendererBackend,
  rememberRendererFallback,
} from './renderer-capabilities.ts';
import {
  getRendererFallbackReasonMessage,
  RENDERER_FALLBACK_REASON_CODES,
} from './renderer-fallback-reasons.ts';
import { deriveRendererPlan } from './renderer-plan.ts';
import type { WebGPURenderer } from './webgpu-renderer.ts';

export type RendererInitResult = {
  renderer: WebGLRenderer | WebGPURenderer;
  backend: RendererBackend;
  adapter?: GPUAdapter | null;
  device?: GPUDevice | null;
  maxPixelRatio: number;
  renderScale: number;
  exposure: number;
};

export type RendererInitConfig = {
  antialias?: boolean;
  exposure?: number;
  maxPixelRatio?: number;
  alpha?: boolean;
  renderScale?: number;
};

async function loadWebGPURenderer() {
  const module = await import('./webgpu-renderer.ts');
  return module.WebGPURenderer;
}

const isMobileUserAgent = isMobileDevice();

export async function initRenderer(
  canvas: HTMLCanvasElement,
  config: RendererInitConfig = {
    antialias: true,
    exposure: 1,
    maxPixelRatio: 2,
    alpha: false,
    renderScale: 1,
  },
): Promise<RendererInitResult | null> {
  if (!ensureWebGL()) {
    return null;
  }

  const {
    antialias = true,
    exposure = 1,
    maxPixelRatio = 2,
    alpha = false,
    renderScale = 1,
  } = config;

  const finalize = (
    renderer: WebGLRenderer | WebGPURenderer,
    backend: RendererBackend,
    adapter: GPUAdapter | null,
    device: GPUDevice | null,
  ): RendererInitResult => {
    const adaptiveMaxPixelRatio = getAdaptiveMaxPixelRatio(maxPixelRatio);
    const effectivePixelRatio = Math.min(
      (window.devicePixelRatio || 1) * renderScale,
      adaptiveMaxPixelRatio,
    );
    renderer.setPixelRatio(effectivePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = exposure;
    return {
      renderer,
      backend,
      adapter,
      device,
      maxPixelRatio,
      renderScale,
      exposure,
    };
  };

  const fallbackToWebGL = (
    reason: string,
    error?: unknown,
    { shouldRetryWebGPU = true } = {},
  ) => {
    console.info(`Falling back to WebGL renderer: ${reason}`);
    if (error) {
      console.debug(error);
    }
    rememberRendererFallback(reason, {
      shouldRetryWebGPU,
      backend: 'webgl',
    });

    const renderer = createWebGLRenderer({
      canvas,
      antialias,
      alpha,
      powerPreference: isMobileUserAgent ? 'default' : 'high-performance',
      failIfMajorPerformanceCaveat: false,
      stencil: true,
      preserveDrawingBuffer: false,
    });
    return finalize(renderer, 'webgl', null, null);
  };

  const capabilities = await getRendererCapabilities();
  const plan = deriveRendererPlan({
    capabilities,
    hasWebGL: true,
  });

  if (plan.backend === 'webgpu' && capabilities?.adapter) {
    const adapter = capabilities.adapter;
    let device = capabilities.device;

    if (!device) {
      try {
        device = await adapter.requestDevice();
      } catch (error) {
        return fallbackToWebGL(
          getRendererFallbackReasonMessage(
            RENDERER_FALLBACK_REASON_CODES.noDevice,
          ),
          error,
        );
      }
    }

    if (!device) {
      return fallbackToWebGL('WebGPU device request returned no device.');
    }

    try {
      const WebGPURendererConstructor = await loadWebGPURenderer();
      const renderer = new WebGPURendererConstructor({
        canvas,
        antialias,
        alpha,
        device,
      });
      if ('init' in renderer && typeof renderer.init === 'function') {
        await renderer.init();
      }
      return finalize(renderer, 'webgpu', adapter, device);
    } catch (error) {
      return fallbackToWebGL(
        getRendererFallbackReasonMessage(
          RENDERER_FALLBACK_REASON_CODES.webgpuRendererCreationFailed,
        ),
        error,
      );
    }
  }

  return fallbackToWebGL(
    plan.reasonMessage ??
      getRendererFallbackReasonMessage(
        RENDERER_FALLBACK_REASON_CODES.webgpuUnavailable,
      ),
    undefined,
    {
      shouldRetryWebGPU: plan.canRetryWebGPU,
    },
  );
}
