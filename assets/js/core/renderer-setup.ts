/* global GPUAdapter, GPUDevice, GPU */
import * as THREE from 'three';
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';
import { ensureWebGL } from '../utils/webgl-check.ts';

type RendererBackend = 'webgl' | 'webgpu';

export type RendererInitResult = {
  renderer: THREE.WebGLRenderer | WebGPURenderer;
  backend: RendererBackend;
  adapter?: GPUAdapter | null;
  device?: GPUDevice | null;
};

export async function initRenderer(
  canvas: HTMLCanvasElement,
  config: {
    antialias?: boolean;
    exposure?: number;
    maxPixelRatio?: number;
    alpha?: boolean;
  } = {
    antialias: true,
    exposure: 1,
    maxPixelRatio: 2,
    alpha: false,
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
  } = config;

  const finalize = (
    renderer: THREE.WebGLRenderer | WebGPURenderer,
    backend: RendererBackend,
    adapter: GPUAdapter | null,
    device: GPUDevice | null
  ): RendererInitResult => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = exposure;
    return { renderer, backend, adapter, device };
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
