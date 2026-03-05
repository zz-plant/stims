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
  triedWebGPU: boolean;
};

export function deriveRendererPlan({
  capabilities,
  hasWebGL,
  xrSupported = false,
}: {
  capabilities: Pick<
    RendererCapabilities,
    | 'preferredBackend'
    | 'fallbackReason'
    | 'fallbackReasonCode'
    | 'triedWebGPU'
    | 'shouldRetryWebGPU'
  > | null;
  hasWebGL: boolean;
  xrSupported?: boolean;
}): RendererPlan {
  if (xrSupported && hasWebGL) {
    return {
      backend: 'webgl',
      reasonCode: RENDERER_FALLBACK_REASON_CODES.xrRequiresWebGL,
      reasonMessage: getRendererFallbackReasonMessage(
        RENDERER_FALLBACK_REASON_CODES.xrRequiresWebGL,
      ),
      canRetryWebGPU: true,
      triedWebGPU: false,
    };
  }

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
      triedWebGPU: false,
    };
  }

  if (capabilities.preferredBackend === 'webgpu') {
    return {
      backend: 'webgpu',
      reasonCode: null,
      reasonMessage: null,
      canRetryWebGPU: false,
      triedWebGPU: capabilities.triedWebGPU,
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
    triedWebGPU: capabilities.triedWebGPU,
  };
}

export async function getRendererPlan({
  forceRetry = false,
  xrSupported = false,
}: {
  forceRetry?: boolean;
  xrSupported?: boolean;
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
      xrSupported,
    }),
  };
}
