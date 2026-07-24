import type { RendererCapabilities } from './renderer-capabilities.ts';
import type { ensureWebGL } from './webgl-check';

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
  allowWebGLFallback: boolean;
  runMode: 'full' | 'fallback' | 'blocked';
  blockReason: 'rendering-unavailable' | 'webgpu-required' | null;
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

  const allowWebGLFallback = Boolean(toy.allowWebGLFallback);
  const requiresWebGPU = Boolean(toy.requiresWebGPU);
  const isWebGPU = capabilities.preferredBackend === 'webgpu';
  const blockReason: ToyCapabilityDecision['blockReason'] = !supportsRendering
    ? 'rendering-unavailable'
    : requiresWebGPU && !isWebGPU && !allowWebGLFallback
      ? 'webgpu-required'
      : null;

  const runMode: ToyCapabilityDecision['runMode'] = blockReason
    ? 'blocked'
    : isWebGPU
      ? 'full'
      : 'fallback';

  return {
    capabilities,
    supportsRendering,
    allowWebGLFallback,
    runMode,
    blockReason,
  };
}
