import type { ensureWebGL } from '../utils';
import type { RendererCapabilities } from './renderer-capabilities.ts';

type ToyCapabilityOptions = {
  title?: string;
  requiresWebGPU?: boolean;
  allowWebGLFallback?: boolean;
};

type RenderCapabilityCheckInput = {
  toy: ToyCapabilityOptions;
  rendererCapabilities: () => Promise<RendererCapabilities>;
  ensureWebGLCheck: typeof ensureWebGL;
  initialCapabilities?: RendererCapabilities;
};

export type ToyCapabilityDecision = {
  capabilities: RendererCapabilities;
  supportsRendering: boolean;
  shouldShowCapabilityError: boolean;
  allowWebGLFallback: boolean;
};

export async function assessToyCapabilities({
  toy,
  rendererCapabilities,
  ensureWebGLCheck,
  initialCapabilities,
}: RenderCapabilityCheckInput): Promise<ToyCapabilityDecision> {
  const capabilities = initialCapabilities ?? (await rendererCapabilities());
  const supportsRendering = ensureWebGLCheck({
    title: toy.title
      ? `${toy.title} needs graphics acceleration`
      : 'Graphics support required',
    description:
      'We could not detect WebGL or WebGPU support on this device. Try a modern browser with hardware acceleration enabled.',
  });

  const shouldShowCapabilityError =
    Boolean(toy.requiresWebGPU) && capabilities.preferredBackend !== 'webgpu';

  return {
    capabilities,
    supportsRendering,
    shouldShowCapabilityError,
    allowWebGLFallback: Boolean(toy.allowWebGLFallback),
  };
}
