import { createMilkdropWebGPUFeedbackManager } from './feedback-manager-webgpu.ts';
import type { MilkdropRendererAdapterConfig } from './renderer-adapter.ts';
import {
  createMilkdropRendererAdapterCore,
  WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
} from './renderer-adapter.ts';

export type MilkdropWebGPURendererAdapterConfig = Omit<
  MilkdropRendererAdapterConfig,
  'backend'
>;

export function createMilkdropWebGPURendererAdapter(
  config: MilkdropWebGPURendererAdapterConfig,
) {
  return createMilkdropRendererAdapterCore({
    ...config,
    backend: 'webgpu',
    behavior: WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
    createFeedbackManager: createMilkdropWebGPUFeedbackManager,
  });
}
