/* global GPUAdapter, GPUDevice, GPU */
import * as THREE from 'three';
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';
import { ensureWebGL } from '../utils/webgl-check.js';

type RendererBackend = 'webgl' | 'webgpu';

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
  } = config;

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

  const fallbackToWebGL = (reason: string, error?: unknown) => {
    console.info(`Falling back to WebGL renderer: ${reason}`);
    if (error) {
      console.debug(error);
    }
    const renderer = new THREE.WebGLRenderer({ canvas, antialias, alpha });
    return finalize(renderer, 'webgl', null, null);
  };

  const { gpu } = navigator as Navigator & { gpu?: GPU }; 
  if (!gpu?.requestAdapter) {
    return fallbackToWebGL('WebGPU is not available in this browser.');
  }

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return fallbackToWebGL('No compatible WebGPU adapter was found.');
    }

    let device: GPUDevice | null = null;
    try {
      device = await adapter.requestDevice();
    } catch (error) {
      return fallbackToWebGL('Unable to acquire a WebGPU device.', error);
    }

    if (!device) {
      return fallbackToWebGL('WebGPU device request returned no device.');
    }

    try {
      const renderer = new WebGPURenderer({ canvas, antialias, alpha, adapter, device });
      return finalize(renderer, 'webgpu', adapter, device);
    } catch (error) {
      return fallbackToWebGL('Failed to create a WebGPU renderer.', error);
    }
  } catch (error) {
    return fallbackToWebGL('WebGPU initialization failed.', error);
  }
}
