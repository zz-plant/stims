import {
  getRendererCapabilities,
  getRenderingSupport,
  type RendererCapabilities,
} from './renderer-capabilities.ts';
import {
  getRendererFallbackReasonMessage,
  RENDERER_FALLBACK_REASON_CODES,
  type RendererFallbackReasonCode,
} from './renderer-fallback-reasons.ts';

export type RendererPlan = {
  backend: 'webgpu' | 'webgl' | null;
  reasonCode: RendererFallbackReasonCode | null;
  reasonMessage: string | null;
  canRetryWebGPU: boolean;
};

export function deriveRendererPlan({
  capabilities,
  hasWebGL,
}: {
  capabilities: Pick<
    RendererCapabilities,
    | 'preferredBackend'
    | 'fallbackReason'
    | 'fallbackReasonCode'
    | 'shouldRetryWebGPU'
  > | null;
  hasWebGL: boolean;
}): RendererPlan {
  if (!capabilities) {
    return {
      backend: hasWebGL ? 'webgl' : null,
      reasonCode: hasWebGL
        ? RENDERER_FALLBACK_REASON_CODES.rendererUnavailable
        : RENDERER_FALLBACK_REASON_CODES.rendererUnavailable,
      reasonMessage: getRendererFallbackReasonMessage(
        RENDERER_FALLBACK_REASON_CODES.rendererUnavailable,
      ),
      canRetryWebGPU: false,
    };
  }

  if (capabilities.preferredBackend === 'webgpu') {
    return {
      backend: 'webgpu',
      reasonCode: null,
      reasonMessage: null,
      canRetryWebGPU: false,
    };
  }

  if (!capabilities.preferredBackend) {
    return {
      backend: null,
      reasonCode:
        capabilities.fallbackReasonCode ??
        RENDERER_FALLBACK_REASON_CODES.rendererUnavailable,
      reasonMessage:
        capabilities.fallbackReason ??
        getRendererFallbackReasonMessage(
          RENDERER_FALLBACK_REASON_CODES.rendererUnavailable,
        ),
      canRetryWebGPU: capabilities.shouldRetryWebGPU,
    };
  }

  return {
    backend: 'webgl',
    reasonCode:
      capabilities.fallbackReasonCode ?? RENDERER_FALLBACK_REASON_CODES.unknown,
    reasonMessage:
      capabilities.fallbackReason ??
      getRendererFallbackReasonMessage(RENDERER_FALLBACK_REASON_CODES.unknown),
    canRetryWebGPU: capabilities.shouldRetryWebGPU,
  };
}

export async function getRendererPlan({
  forceRetry = false,
}: {
  forceRetry?: boolean;
} = {}): Promise<{
  plan: RendererPlan;
  capabilities: RendererCapabilities | null;
}> {
  const [capabilities, support] = await Promise.all([
    getRendererCapabilities({ forceRetry }).catch(() => null),
    Promise.resolve(getRenderingSupport()),
  ]);

  return {
    capabilities,
    plan: deriveRendererPlan({
      capabilities,
      hasWebGL: support.hasWebGL,
    }),
  };
}
