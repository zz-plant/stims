/* global GPUAdapter, GPUDevice */
import {
  ACESFilmicToneMapping,
  SRGBColorSpace,
  type WebGLRenderer,
} from 'three';
import {
  getDeviceEnvironmentProfile,
  isMobileDevice,
} from '../utils/device-detect';
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
import {
  DEFAULT_WEBGPU_INIT_TIMEOUT_MS,
  resolveWithTimeout,
} from './renderer-init-timeout.ts';
import { deriveRendererPlan } from './renderer-plan.ts';
import { shouldPreferWebGLForKnownCompatibilityGaps } from './renderer-query-override.ts';
import { getRendererBackendMaxPixelRatioCap } from './renderer-settings.ts';
import { ensureWebGL } from './webgl-check';
import { createWebGLRenderer } from './webgl-renderer';
import type { WebGPURenderer } from './webgpu-renderer.ts';

export type RendererInitResult = {
  renderer: WebGLRenderer | WebGPURenderer;
  backend: RendererBackend;
  adapter?: GPUAdapter | null;
  device?: GPUDevice | null;
  maxPixelRatio: number;
  renderScale: number;
  adaptiveMaxPixelRatioMultiplier: number;
  adaptiveRenderScaleMultiplier: number;
  adaptiveDensityMultiplier: number;
  exposure: number;
};

export type RendererInitConfig = {
  antialias?: boolean;
  exposure?: number;
  maxPixelRatio?: number;
  alpha?: boolean;
  renderScale?: number;
  adaptiveMaxPixelRatioMultiplier?: number;
  adaptiveRenderScaleMultiplier?: number;
  adaptiveDensityMultiplier?: number;
  webgpuInitTimeoutMs?: number;
};

async function loadWebGPURenderer() {
  const module = await import('./webgpu-renderer.ts');
  return module.WebGPURenderer;
}

const isMobileUserAgent = isMobileDevice();
const deviceEnvironment = getDeviceEnvironmentProfile();

function disposeRenderer(renderer: Partial<WebGLRenderer | WebGPURenderer>) {
  if (
    'setAnimationLoop' in renderer &&
    typeof renderer.setAnimationLoop === 'function'
  ) {
    renderer.setAnimationLoop(null);
  }

  if ('dispose' in renderer && typeof renderer.dispose === 'function') {
    renderer.dispose();
  }
}

export async function initRenderer(
  canvas: HTMLCanvasElement,
  config: RendererInitConfig = {
    antialias: true,
    exposure: 1,
    maxPixelRatio: isMobileUserAgent ? 1.1 : 1.5,
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
    maxPixelRatio = isMobileUserAgent ? 1.1 : 1.5,
    alpha = false,
    renderScale = 1,
    adaptiveMaxPixelRatioMultiplier = 1,
    adaptiveRenderScaleMultiplier = 1,
    adaptiveDensityMultiplier = 1,
    webgpuInitTimeoutMs = DEFAULT_WEBGPU_INIT_TIMEOUT_MS,
  } = config;

  const finalize = (
    renderer: WebGLRenderer | WebGPURenderer,
    backend: RendererBackend,
    adapter: GPUAdapter | null,
    device: GPUDevice | null,
  ): RendererInitResult => {
    const adaptiveMaxPixelRatio = getAdaptiveMaxPixelRatio(maxPixelRatio);
    const backendPixelRatioCap = getRendererBackendMaxPixelRatioCap({
      backend,
      isMobile: isMobileUserAgent,
      browserFamily: deviceEnvironment.browserFamily,
      platformFamily: deviceEnvironment.platformFamily,
    });
    const effectivePixelRatio = Math.min(
      (window.devicePixelRatio || 1) * renderScale,
      adaptiveMaxPixelRatio,
      backendPixelRatioCap,
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
      adaptiveMaxPixelRatioMultiplier,
      adaptiveRenderScaleMultiplier,
      adaptiveDensityMultiplier,
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

  const capabilities = await getRendererCapabilities({
    preferWebGLForKnownCompatibilityGaps:
      shouldPreferWebGLForKnownCompatibilityGaps(),
    webgpuInitTimeoutMs,
  });
  const plan = deriveRendererPlan({
    capabilities,
    hasWebGL: true,
  });

  if (plan.backend === 'webgpu' && capabilities?.adapter) {
    const adapter = capabilities.adapter;
    let device = capabilities.device;

    if (!device) {
      try {
        device = await resolveWithTimeout(
          adapter.requestDevice(),
          webgpuInitTimeoutMs,
          'WebGPU device initialization timed out.',
        );
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
        const initPromise = renderer.init();
        let rendererDisposed = false;
        const disposeTimedOutRenderer = () => {
          if (rendererDisposed) {
            return;
          }

          rendererDisposed = true;
          disposeRenderer(renderer);
        };

        try {
          await resolveWithTimeout(
            initPromise,
            webgpuInitTimeoutMs,
            'WebGPU renderer initialization timed out.',
          );
        } catch (error) {
          disposeTimedOutRenderer();
          void initPromise.then(disposeTimedOutRenderer).catch(() => {});
          return fallbackToWebGL(
            getRendererFallbackReasonMessage(
              RENDERER_FALLBACK_REASON_CODES.webgpuInitFailed,
            ),
            error,
          );
        }
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
