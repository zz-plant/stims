/* global GPUAdapter, GPUDevice */
import {
  ACESFilmicToneMapping,
  SRGBColorSpace,
  type WebGLRenderer,
} from 'three';
import {
  getDeviceEnvironmentProfile,
  isMobileDevice,
} from '../utils/browser/device-detect';
import { getAdaptiveMaxPixelRatio } from './device-profile.ts';
import {
  FallbackEvent,
  FallbackState,
  FallbackStateMachine,
} from './fallback-state.ts';
import { resolveGpuPowerPreference } from './power-state.ts';
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
import { isAgentMode } from './url-params.ts';
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

// Canvases that have ever had a WebGPURenderer constructed on them. A canvas
// permanently binds its first context type, so this must outlive a single
// initRenderer call: device-loss recovery re-invokes initRenderer with the
// same element, and a WebGL fallback there needs to know the canvas is
// already WebGPU-bound.
const webgpuBoundCanvases = new WeakSet<HTMLCanvasElement>();

function shouldPreserveDrawingBufferForValidation() {
  if (typeof window === 'undefined') {
    return false;
  }
  return isAgentMode();
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
  const stateMachine = new FallbackStateMachine(FallbackState.Initial);

  if (!ensureWebGL()) {
    stateMachine.transition(FallbackEvent.FAIL_BACKEND);
    return null;
  }

  stateMachine.transition(FallbackEvent.CHECK_WEBGL);

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

  // A canvas element permanently binds the first rendering-context type
  // requested from it. Once a WebGPURenderer has been constructed on the
  // canvas, `getContext('webgl2')` returns null there forever — so a WebGL
  // fallback after a failed WebGPU attempt must run on a fresh element, or
  // the renderer silently gets no context and the stage stays black.
  let webgpuBoundToCanvas = false;

  const resolveFallbackCanvas = (): HTMLCanvasElement => {
    if (
      (!webgpuBoundToCanvas && !webgpuBoundCanvases.has(canvas)) ||
      typeof canvas.cloneNode !== 'function'
    ) {
      return canvas;
    }
    const replacement = canvas.cloneNode(false) as HTMLCanvasElement;
    if (canvas.parentNode) {
      canvas.parentNode.replaceChild(replacement, canvas);
    }
    console.info(
      'Replaced WebGPU-bound canvas with a fresh element for the WebGL fallback.',
    );
    return replacement;
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
      canvas: resolveFallbackCanvas(),
      antialias,
      alpha,
      powerPreference: resolveGpuPowerPreference(),
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

  stateMachine.transition(FallbackEvent.START_PROBE_WEBGPU);

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
        stateMachine.transition(FallbackEvent.RESOLVE_WEBGPU);
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
      stateMachine.transition(FallbackEvent.RESOLVE_WEBGPU);
      return fallbackToWebGL('WebGPU device request returned no device.');
    }

    try {
      const WebGPURendererConstructor = await loadWebGPURenderer();
      // From this point the canvas may carry a `webgpu` context — even a
      // timed-out init keeps running in the background and can bind it later,
      // so any fallback below must treat the canvas as WebGPU-bound. The
      // module-level set makes this survive into *future* initRenderer calls:
      // device-loss recovery re-runs init with the same canvas, and a WebGL
      // fallback in that later run would otherwise reuse the WebGPU-bound
      // element, fail context creation ("existing context of a different
      // type"), and leave the stage permanently black.
      webgpuBoundToCanvas = true;
      webgpuBoundCanvases.add(canvas);
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
          stateMachine.transition(FallbackEvent.TIMEOUT_WEBGPU);
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
          stateMachine.transition(FallbackEvent.RESOLVE_WEBGPU);
          return fallbackToWebGL(
            getRendererFallbackReasonMessage(
              RENDERER_FALLBACK_REASON_CODES.webgpuInitFailed,
            ),
            error,
          );
        }
      }
      stateMachine.transition(FallbackEvent.RESOLVE_WEBGPU);
      teardownAbort();
      return finalize(renderer, 'webgpu', adapter, device);
    } catch (error) {
      teardownAbort();
      stateMachine.transition(FallbackEvent.RESOLVE_WEBGPU);
      return fallbackToWebGL(
        getRendererFallbackReasonMessage(
          RENDERER_FALLBACK_REASON_CODES.webgpuRendererCreationFailed,
        ),
        error,
      );
    }
  }

  stateMachine.transition(FallbackEvent.RESOLVE_WEBGPU);
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
