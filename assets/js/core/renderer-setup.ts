/* global GPUAdapter, GPUDevice */
import { ACESFilmicToneMapping, SRGBColorSpace, WebGLRenderer } from 'three';
import { isMobileDevice } from '../utils/device-detect';
import { ensureWebGL } from '../utils/webgl-check';
import { createWebGLRenderer } from '../utils/webgl-renderer';
import {
  getRendererCapabilities,
  type RendererBackend,
  rememberRendererFallback,
} from './renderer-capabilities.ts';
import type { WebGPURenderer } from './webgpu-renderer.ts';

export type RendererInitResult = {
  renderer: WebGLRenderer | WebGPURenderer;
  backend: RendererBackend;
  adapter?: GPUAdapter | null;
  device?: GPUDevice | null;
  maxPixelRatio: number;
  renderScale: number;
  exposure: number;
  xrSupported: boolean;
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

const XR_SESSION_MODES = ['immersive-vr', 'immersive-ar'] as const;

async function detectXrSupport(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const xr = (
    navigator as Navigator & {
      xr?: { isSessionSupported?: (mode: string) => Promise<boolean> };
    }
  ).xr;
  if (!xr?.isSessionSupported) return false;

  const results = await Promise.allSettled(
    XR_SESSION_MODES.map((mode) => xr.isSessionSupported?.(mode)),
  );

  return results.some(
    (result) => result.status === 'fulfilled' && Boolean(result.value),
  );
}

const getAdaptiveMaxPixelRatio = (maxPixelRatio: number) => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return maxPixelRatio;
  }

  const deviceMemory =
    'deviceMemory' in navigator
      ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ??
        null)
      : null;
  const hardwareConcurrency = navigator.hardwareConcurrency ?? null;
  const prefersReducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  const lowPowerDevice =
    isMobileUserAgent ||
    prefersReducedMotion ||
    (deviceMemory !== null && deviceMemory <= 4) ||
    (hardwareConcurrency !== null && hardwareConcurrency <= 4);

  if (!lowPowerDevice) {
    return maxPixelRatio;
  }

  return Math.min(maxPixelRatio, 1.25);
};

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

  const xrSupported = await detectXrSupport();

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
    if (renderer instanceof WebGLRenderer) {
      renderer.xr.enabled = xrSupported;
      if (xrSupported) {
        renderer.xr.setReferenceSpaceType?.('local-floor');
      }
    }
    return {
      renderer,
      backend,
      adapter,
      device,
      maxPixelRatio,
      renderScale,
      exposure,
      xrSupported,
    };
  };

  const fallbackToWebGL = (
    reason: string,
    error?: unknown,
    { shouldRetryWebGPU = true, triedWebGPU = true } = {},
  ) => {
    console.info(`Falling back to WebGL renderer: ${reason}`);
    if (error) {
      console.debug(error);
    }
    rememberRendererFallback(reason, { shouldRetryWebGPU, triedWebGPU });

    // Mobile-optimized WebGL context attributes
    const renderer = createWebGLRenderer({
      canvas,
      antialias,
      alpha,
      // Use high-performance mode on desktop, default on mobile for better battery life
      powerPreference: isMobileUserAgent ? 'default' : 'high-performance',
      // Don't fail if there are performance caveats - mobile GPUs often have them
      failIfMajorPerformanceCaveat: false,
      // Enable stencil buffer for better rendering compatibility
      stencil: true,
      // Preserve drawing buffer for screenshots/recording if needed
      preserveDrawingBuffer: false,
    });
    return finalize(renderer, 'webgl', null, null);
  };

  if (xrSupported) {
    return fallbackToWebGL(
      'WebXR session support detected. Using WebGL for XR compatibility.',
      undefined,
      { shouldRetryWebGPU: true, triedWebGPU: false },
    );
  }

  const capabilities = await getRendererCapabilities();

  if (capabilities.preferredBackend === 'webgpu' && capabilities.adapter) {
    const adapter = capabilities.adapter;
    let device = capabilities.device;

    if (!device) {
      try {
        device = await adapter.requestDevice();
      } catch (error) {
        return fallbackToWebGL('Unable to acquire a WebGPU device.', error);
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
      return finalize(renderer, 'webgpu', adapter, device);
    } catch (error) {
      return fallbackToWebGL('Failed to create a WebGPU renderer.', error);
    }
  }

  return fallbackToWebGL(
    capabilities.fallbackReason ?? 'WebGPU is not available in this browser.',
    undefined,
    {
      shouldRetryWebGPU: capabilities.shouldRetryWebGPU,
      triedWebGPU: capabilities.triedWebGPU,
    },
  );
}
