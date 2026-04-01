import { WEBGL_MILKDROP_BACKEND_BEHAVIOR } from './backend-behavior';
import { createMilkdropWebGLFeedbackManager } from './feedback-manager-webgl.ts';
import type { MilkdropRendererAdapterConfig } from './renderer-adapter.ts';
import { createMilkdropRendererAdapterCore } from './renderer-adapter.ts';
import { createMilkdropSegmentBatchingLayer } from './renderer-segment-batching.ts';

export type MilkdropWebGLRendererAdapterConfig = Omit<
  MilkdropRendererAdapterConfig,
  'backend'
>;

export function createMilkdropWebGLRendererAdapter(
  config: MilkdropWebGLRendererAdapterConfig,
) {
  return createMilkdropRendererAdapterCore({
    ...config,
    backend: 'webgl',
    behavior: WEBGL_MILKDROP_BACKEND_BEHAVIOR,
    createFeedbackManager: createMilkdropWebGLFeedbackManager,
    batcher:
      config.batcher === undefined
        ? createMilkdropSegmentBatchingLayer()
        : config.batcher,
  });
}
