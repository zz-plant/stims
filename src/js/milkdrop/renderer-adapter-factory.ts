import type { MilkdropRendererAdapterConfig } from './renderer-adapter.ts';
import { createMilkdropWebGLRendererAdapter } from './renderer-adapter-webgl.ts';
import type { MilkdropRendererAdapter } from './renderer-types.ts';

export { getFeedbackBackendProfile } from './renderer-adapter.ts';

export function createMilkdropRendererAdapter(
  config: MilkdropRendererAdapterConfig & { backend: 'webgl' },
): MilkdropRendererAdapter;
export function createMilkdropRendererAdapter(
  config: MilkdropRendererAdapterConfig & { backend: 'webgpu' },
): Promise<MilkdropRendererAdapter>;
export function createMilkdropRendererAdapter(
  config: MilkdropRendererAdapterConfig,
): MilkdropRendererAdapter | Promise<MilkdropRendererAdapter> {
  if (config.backend === 'webgpu') {
    return import('./renderer-adapter-webgpu.ts').then(
      ({ createMilkdropWebGPURendererAdapter }) =>
        createMilkdropWebGPURendererAdapter(config),
    );
  }

  return createMilkdropWebGLRendererAdapter(config);
}
