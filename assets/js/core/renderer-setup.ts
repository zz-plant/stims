/* global GPUAdapter, GPUDevice */
import * as THREE from 'three';
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';
import { ensureWebGL } from '../utils/webgl-check.ts';
import {
  getCachedRendererCapabilities,
  getRendererCapabilities,
  rememberRendererFallback,
  type RendererBackend,
  type RendererCapabilities,
} from './renderer-capabilities.ts';

export type RendererInitResult = {
  renderer: THREE.WebGLRenderer | WebGPURenderer;
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
  onCapabilitiesResolved?: (capabilities: RendererCapabilities) => void;
};

export async function initRenderer(
  canvas: HTMLCanvasElement,
  config: RendererInitConfig = {
    antialias: true,
    exposure: 1,
    maxPixelRatio: 2,
    alpha: false,
    renderScale: 1,
  }
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
    onCapabilitiesResolved,
  } = config;

  const emitCapabilities = (capabilities?: RendererCapabilities | null) => {
    if (capabilities && typeof onCapabilitiesResolved === 'function') {
      onCapabilitiesResolved(capabilities);
    }
  };

  const finalize = (
    renderer: THREE.WebGLRenderer | WebGPURenderer,
    backend: RendererBackend,
    adapter: GPUAdapter | null,
    device: GPUDevice | null
  ): RendererInitResult => {
    const effectivePixelRatio = Math.min(
      (window.devicePixelRatio || 1) * renderScale,
      maxPixelRatio
    );
    renderer.setPixelRatio(effectivePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
    { shouldRetryWebGPU = true, triedWebGPU = true } = {}
  ) => {
    console.info(`Falling back to WebGL renderer: ${reason}`);
    if (error) {
      console.debug(error);
    }
    const capabilities = rememberRendererFallback(reason, { shouldRetryWebGPU, triedWebGPU });
    emitCapabilities(capabilities);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias, alpha });
    return finalize(renderer, 'webgl', null, null);
  };

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
      const renderer = new WebGPURenderer({ canvas, antialias, alpha, adapter, device });
      emitCapabilities(getCachedRendererCapabilities() ?? capabilities);
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
    }
  );
}
