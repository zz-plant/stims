/* global GPUAdapter, GPU */
import WebGL from 'three/examples/jsm/capabilities/WebGL.js';
import { ensureWebGL } from '../utils/webgl-check.js';

export type RendererBackend = 'webgl' | 'webgpu';

export type RendererCapabilities = {
  preferredBackend: RendererBackend;
  webglSupported: boolean;
  webgpuSupported: boolean;
  adapter: GPUAdapter | null;
  attemptedWebGPU: boolean;
  shouldRetryWebGPU: boolean;
  hasRenderingSupport: boolean;
  fallbackReason?: string;
  probeError?: unknown;
};

let capabilityProbePromise: Promise<RendererCapabilities> | null = null;

function isWebGLAvailable() {
  return (
    typeof WebGL !== 'undefined' &&
    typeof WebGL.isWebGLAvailable === 'function' &&
    WebGL.isWebGLAvailable()
  );
}

async function probeRendererCapabilities(): Promise<RendererCapabilities> {
  const webglSupported = isWebGLAvailable();
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { gpu?: GPU });
  const { gpu } = nav ?? {};
  const webgpuSupported = Boolean(gpu?.requestAdapter);

  if (!webglSupported && !webgpuSupported) {
    ensureWebGL();
    return {
      preferredBackend: 'webgl',
      webglSupported,
      webgpuSupported,
      adapter: null,
      attemptedWebGPU: false,
      shouldRetryWebGPU: false,
      hasRenderingSupport: false,
      fallbackReason: 'No WebGL or WebGPU support detected.',
    };
  }

  let adapter: GPUAdapter | null = null;
  let probeError: unknown;
  let attemptedWebGPU = false;

  if (webgpuSupported) {
    attemptedWebGPU = true;
    try {
      adapter = (await gpu?.requestAdapter()) ?? null;
    } catch (error) {
      probeError = error;
    }
  }

  const preferredBackend: RendererBackend = adapter ? 'webgpu' : 'webgl';
  const fallbackReason = adapter
    ? undefined
    : webgpuSupported
      ? 'No compatible WebGPU adapter was found.'
      : 'WebGPU is not available in this browser.';

  const hasRenderingSupport = webglSupported || Boolean(adapter);
  const shouldRetryWebGPU = webgpuSupported && !adapter && !probeError;

  if (!hasRenderingSupport) {
    ensureWebGL();
  }

  return {
    preferredBackend,
    webglSupported,
    webgpuSupported,
    adapter,
    attemptedWebGPU,
    shouldRetryWebGPU,
    hasRenderingSupport,
    fallbackReason,
    probeError,
  };
}

export async function getRendererCapabilities(options: { forceRefresh?: boolean } = {}) {
  if (!capabilityProbePromise || options.forceRefresh) {
    capabilityProbePromise = probeRendererCapabilities();
  }

  return capabilityProbePromise;
}

export function resetRendererCapabilitiesCache() {
  capabilityProbePromise = null;
}
