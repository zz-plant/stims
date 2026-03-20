import type { MilkdropRendererAdapterConfig } from './renderer-adapter.ts';
import { createMilkdropWebGLRendererAdapter } from './renderer-adapter-webgl.ts';
import { createMilkdropWebGPURendererAdapter } from './renderer-adapter-webgpu.ts';

export { getFeedbackBackendProfile } from './renderer-adapter.ts';

export function createMilkdropRendererAdapter(
  config: MilkdropRendererAdapterConfig,
) {
  if (config.backend === 'webgpu') {
    return createMilkdropWebGPURendererAdapter(config);
  }

  return createMilkdropWebGLRendererAdapter(config);
}
