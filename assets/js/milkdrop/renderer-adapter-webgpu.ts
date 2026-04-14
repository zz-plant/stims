import { WEBGPU_MILKDROP_BACKEND_BEHAVIOR } from './backend-behavior';
import { createMilkdropWebGPUFeedbackManager } from './feedback-manager-webgpu.ts';
import type { MilkdropRendererAdapterConfig } from './renderer-adapter.ts';
import { createMilkdropRendererAdapterCore } from './renderer-adapter.ts';
import { createWebGPUBatchingLayer } from './renderer-adapter-webgpu-batching.ts';
import {
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  type MilkdropWebGpuOptimizationFlags,
} from './webgpu-optimization-flags.ts';
import { shouldUseSafeMilkdropWebGpuPath } from './webgpu-query-override.ts';

export type MilkdropWebGPURendererAdapterConfig = Omit<
  MilkdropRendererAdapterConfig,
  'backend'
>;

const SAFE_WEBGPU_BEHAVIOR = {
  ...WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
  supportsShapeGradient: false,
  supportsShapeShaderFill: false,
  supportsFeedbackPass: false,
} as const;

function buildSafeWebGpuOptimizationFlags(
  flags: MilkdropWebGpuOptimizationFlags | undefined,
): MilkdropWebGpuOptimizationFlags {
  return {
    ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
    ...flags,
    proceduralMainWave: false,
    proceduralTrailWaves: false,
    proceduralCustomWaves: false,
    proceduralMesh: false,
    proceduralMotionVectors: false,
    directFeedbackShaders: false,
  };
}

export function createMilkdropWebGPURendererAdapter(
  config: MilkdropWebGPURendererAdapterConfig,
) {
  const useSafeWebGpuPath = shouldUseSafeMilkdropWebGpuPath();
  return createMilkdropRendererAdapterCore({
    ...config,
    backend: 'webgpu',
    behavior: useSafeWebGpuPath
      ? SAFE_WEBGPU_BEHAVIOR
      : WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
    createFeedbackManager: useSafeWebGpuPath
      ? undefined
      : createMilkdropWebGPUFeedbackManager,
    batcher: useSafeWebGpuPath ? null : createWebGPUBatchingLayer(),
    webgpuOptimizationFlags: useSafeWebGpuPath
      ? buildSafeWebGpuOptimizationFlags(config.webgpuOptimizationFlags)
      : config.webgpuOptimizationFlags,
  });
}
