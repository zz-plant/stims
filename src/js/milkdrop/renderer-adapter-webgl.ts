import { WEBGL_MILKDROP_BACKEND_BEHAVIOR } from './backend-behavior';
import { createMilkdropWebGLFeedbackManager } from './feedback-manager-webgl.ts';
import type { MilkdropRendererAdapterConfig } from './renderer-adapter.ts';
import { createMilkdropRendererAdapterCore } from './renderer-adapter.ts';
import type { MilkdropRendererBatcher } from './renderer-adapter-shared';
import { createShapeBatchingLayer } from './renderer-adapter-webgpu-batching.ts';
import { createMilkdropSegmentBatchingLayer } from './renderer-segment-batching.ts';

export type MilkdropWebGLRendererAdapterConfig = Omit<
  MilkdropRendererAdapterConfig,
  'backend'
>;

/**
 * Waves and motion vectors go through the segment batcher, shapes and borders
 * through the GLSL shape batcher. Without the second half every shape
 * instance was its own three.js mesh: martin-the-bridge-of-khazad-dum (~786
 * instances) spent 3.7ms/frame rendering on WebGL against 0.9ms on WebGPU,
 * which has batched shapes since the TSL port.
 */
export function createMilkdropWebGLBatcher(
  options: { fallbackCustomWaves?: boolean } = {},
): MilkdropRendererBatcher {
  const segments = createMilkdropSegmentBatchingLayer(options);
  const shapes = createShapeBatchingLayer();
  return {
    attach: (root) => {
      segments.attach(root);
      shapes.attach(root);
    },
    setShapeTexture: (texture) => shapes.setShapeTexture?.(texture),
    renderWaveGroup: (target, group, waves, alphaMultiplier) =>
      segments.renderWaveGroup(target, group, waves, alphaMultiplier),
    renderLineVisualGroup: (target, group, lines, alphaMultiplier) =>
      segments.renderLineVisualGroup(target, group, lines, alphaMultiplier),
    renderShapeGroup: shapes.renderShapeGroup,
    renderBorderGroup: shapes.renderBorderGroup,
    hideBlendTargets: () => {
      segments.hideBlendTargets();
      shapes.hideBlendTargets?.();
    },
    hideLayer: (layer) => {
      const restoreSegments = segments.hideLayer(layer);
      const restoreShapes = shapes.hideLayer?.(layer);
      return () => {
        restoreSegments();
        restoreShapes?.();
      };
    },
    dispose: () => {
      segments.dispose();
      shapes.dispose();
    },
    disposeWithCaches: () => {
      segments.dispose();
      shapes.disposeWithCaches?.();
    },
  };
}

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
        ? createMilkdropWebGLBatcher({
            fallbackCustomWaves: config.fallbackCustomWaves,
          })
        : config.batcher,
  });
}
