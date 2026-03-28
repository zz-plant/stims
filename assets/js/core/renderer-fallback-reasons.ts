export const RENDERER_FALLBACK_REASON_CODES = {
  rendererUnavailable: 'RENDERER_UNAVAILABLE',
  compatibilityMode: 'COMPATIBILITY_MODE',
  webgpuUnavailable: 'WEBGPU_UNAVAILABLE',
  fallbackAdapter: 'FALLBACK_ADAPTER',
  noAdapter: 'NO_ADAPTER',
  noDevice: 'NO_DEVICE',
  webgpuInitFailed: 'WEBGPU_INIT_FAILED',
  webgpuRendererCreationFailed: 'WEBGPU_RENDERER_CREATION_FAILED',
  rendererInitFailed: 'RENDERER_INIT_FAILED',
  unknown: 'UNKNOWN',
} as const;

export type RendererFallbackReasonCode =
  (typeof RENDERER_FALLBACK_REASON_CODES)[keyof typeof RENDERER_FALLBACK_REASON_CODES];

const REASON_MESSAGES: Record<RendererFallbackReasonCode, string> = {
  RENDERER_UNAVAILABLE: 'Renderer capabilities are unavailable.',
  COMPATIBILITY_MODE: 'Compatibility mode is enabled. Using WebGL.',
  WEBGPU_UNAVAILABLE: 'WebGPU is not available in this browser.',
  FALLBACK_ADAPTER:
    'Only a fallback WebGPU adapter is available. Using WebGL for performance and compatibility.',
  NO_ADAPTER: 'No compatible WebGPU adapter was found.',
  NO_DEVICE: 'Unable to acquire a WebGPU device.',
  WEBGPU_INIT_FAILED: 'WebGPU initialization failed.',
  WEBGPU_RENDERER_CREATION_FAILED: 'Failed to create a WebGPU renderer.',
  RENDERER_INIT_FAILED: 'Renderer initialization failed.',
  UNKNOWN: 'WebGPU fallback engaged.',
};

export function getRendererFallbackReasonMessage(
  code: RendererFallbackReasonCode,
) {
  return REASON_MESSAGES[code];
}

export function inferRendererFallbackReasonCode(
  message: string,
): RendererFallbackReasonCode {
  const entry = Object.entries(REASON_MESSAGES).find(
    ([, candidateMessage]) => candidateMessage === message,
  );
  if (!entry) return RENDERER_FALLBACK_REASON_CODES.unknown;
  return entry[0] as RendererFallbackReasonCode;
}
