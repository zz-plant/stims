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
  FallbackState,
  transition as validateTransition,
} from './fallback-state.ts';
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
import { createRenderScale, type RenderScale } from './renderer-types.ts';
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
  renderScale?: number | RenderScale;
  adaptiveMaxPixelRatioMultiplier?: number;
  adaptiveRenderScaleMultiplier?: number;
  adaptiveDensityMultiplier?: number;
  webgpuInitTimeoutMs?: number;
  forceRetryCapabilities?: boolean;
  preserveDrawingBuffer?: boolean;
};

async function loadWebGPURenderer() {
  const module = await import('./webgpu-renderer.ts');
  return module.WebGPURenderer;
}

const isMobileUserAgent = isMobileDevice();
const deviceEnvironment = getDeviceEnvironmentProfile();

function shouldPreserveDrawingBufferForValidation() {
  if (typeof window === 'undefined') {
    return false;
  }
  return new URLSearchParams(window.location.search).get('agent') === 'true';
}

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
    antialias: !isMobileUserAgent,
    exposure: 1,
    maxPixelRatio: isMobileUserAgent ? 1.1 : 1.5,
    alpha: false,
    renderScale: createRenderScale(1),
  },
): Promise<RendererInitResult | null> {
  let currentState = FallbackState.Initial;

  if (!ensureWebGL()) {
    currentState = validateTransition(
      currentState,
      FallbackState.ErrorNoBackend,
    );
    return null;
  }

  currentState = validateTransition(currentState, FallbackState.ProbingWebgl);

  const {
    antialias = !isMobileUserAgent,
    exposure = 1,
    maxPixelRatio = isMobileUserAgent ? 1.1 : 1.5,
    alpha = false,
    renderScale = createRenderScale(1),
    adaptiveMaxPixelRatioMultiplier = 1,
    adaptiveRenderScaleMultiplier = 1,
    adaptiveDensityMultiplier = 1,
    webgpuInitTimeoutMs = DEFAULT_WEBGPU_INIT_TIMEOUT_MS,
    forceRetryCapabilities = false,
    preserveDrawingBuffer = false,
  } = config;

  const effectiveRenderScale: RenderScale =
    typeof renderScale === 'number'
      ? createRenderScale(renderScale)
      : renderScale;

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
      (window.devicePixelRatio || 1) * effectiveRenderScale,
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
      renderScale: effectiveRenderScale,
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
      preserveDrawingBuffer:
        preserveDrawingBuffer || shouldPreserveDrawingBufferForValidation(),
    });
    return finalize(renderer, 'webgl', null, null);
  };

  const capabilities = await getRendererCapabilities({
    forceRetry: forceRetryCapabilities,
    preferWebGLForKnownCompatibilityGaps:
      shouldPreferWebGLForKnownCompatibilityGaps(),
    webgpuInitTimeoutMs,
  });
  const plan = deriveRendererPlan({
    capabilities,
    hasWebGL: true,
  });

  currentState = validateTransition(currentState, FallbackState.ProbingWebgpu);

  if (plan.backend === 'webgpu' && capabilities?.adapter) {
    const adapter = capabilities.adapter;
    let device = capabilities.device;
    const initAbortController = new AbortController();

    const teardownAbort = () => {
      if (!initAbortController.signal.aborted) {
        initAbortController.abort();
      }
    };

    if (!device) {
      try {
        device = await resolveWithTimeout(
          adapter.requestDevice(),
          webgpuInitTimeoutMs,
          'WebGPU device initialization timed out.',
          initAbortController,
        );
      } catch (error) {
        teardownAbort();
        return fallbackToWebGL(
          getRendererFallbackReasonMessage(
            RENDERER_FALLBACK_REASON_CODES.noDevice,
          ),
          error,
        );
      }
    }

    if (!device) {
      teardownAbort();
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
            initAbortController,
          );
        } catch (error) {
          disposeTimedOutRenderer();
          currentState = validateTransition(
            currentState,
            FallbackState.RendererTimeout,
          );
          teardownAbort();
          void initPromise
            .then(() => {
              // By the time the deferred init resolves the user may have
              // navigated away, removing the canvas from the DOM. Only
              // dispose if the abort controller hasn't been cancelled and
              // the canvas is still connected (i.e. still in the document).
              if (!initAbortController.signal.aborted && canvas.isConnected) {
                disposeTimedOutRenderer();
              }
            })
            .catch((error: unknown) => {
              console.warn('WebGPU renderer init timed out.', error);
            });
          currentState = validateTransition(
            currentState,
            FallbackState.RendererReady,
          );
          return fallbackToWebGL(
            getRendererFallbackReasonMessage(
              RENDERER_FALLBACK_REASON_CODES.webgpuInitFailed,
            ),
            error,
          );
        }
      }
      currentState = validateTransition(
        currentState,
        FallbackState.RendererReady,
      );
      teardownAbort();
      return finalize(renderer, 'webgpu', adapter, device);
    } catch (error) {
      teardownAbort();
      return fallbackToWebGL(
        getRendererFallbackReasonMessage(
          RENDERER_FALLBACK_REASON_CODES.webgpuRendererCreationFailed,
        ),
        error,
      );
    }
  }

  currentState = validateTransition(currentState, FallbackState.RendererReady);
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
