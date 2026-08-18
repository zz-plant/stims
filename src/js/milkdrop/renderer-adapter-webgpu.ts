import { recordRendererOptimizationTelemetry } from '../core/renderer-capabilities.ts';
import { WEBGPU_MILKDROP_BACKEND_BEHAVIOR } from './backend-behavior';
import { createMilkdropWebGPUFeedbackManager } from './feedback-manager-webgpu.ts';
import type { MilkdropRendererAdapterConfig } from './renderer-adapter.ts';
import { createMilkdropRendererAdapterCore } from './renderer-adapter.ts';
import {
  createNativeWebGPUShapeBatchingLayer,
  createWebGPUBatchingLayer,
} from './renderer-adapter-webgpu-batching.ts';
import { createNativeWebGpuShapeBatchMaterialFactory } from './renderer-backends/webgpu-batching-materials.ts';
import { resolveMilkdropRendererExecutionPlan } from './renderer-execution-plan.ts';
import {
  applyNativeWebGpuMaterialCompatibilityFlags,
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  type MilkdropWebGpuOptimizationFlags,
} from './webgpu-optimization-flags.ts';
import {
  resolveMilkdropWebGpuFeatureRouting,
  shouldEnableNativeMilkdropWebGpuFeedback,
  shouldUseSafeMilkdropWebGpuPath,
} from './webgpu-query-override.ts';

export type MilkdropWebGPURendererAdapterConfig = Omit<
  MilkdropRendererAdapterConfig,
  'backend'
>;

function buildSafeWebGpuOptimizationFlags(
  flags: MilkdropWebGpuOptimizationFlags | undefined,
): MilkdropWebGpuOptimizationFlags {
  const featureRouting = resolveMilkdropWebGpuFeatureRouting();
  for (const [featureName, decision] of Object.entries(featureRouting)) {
    if (!decision.enabled) {
      recordRendererOptimizationTelemetry({
        counter: 'milkdropWebGpuFeatureDisabled',
      });
      console.info(
        `[Stims] MilkDrop WebGPU ${featureName} disabled: ${decision.reason}`,
      );
    }
  }

  return {
    ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
    ...flags,
    proceduralMainWave: featureRouting.proceduralMainWave.enabled,
    proceduralTrailWaves: featureRouting.proceduralTrailWaves.enabled,
    proceduralCustomWaves: featureRouting.proceduralCustomWaves.enabled,
    proceduralMesh: featureRouting.proceduralMesh.enabled,
    proceduralMotionVectors: featureRouting.proceduralMotionVectors.enabled,
    directFeedbackShaders: featureRouting.directFeedbackShaders.enabled,
    gpuComputeVM: featureRouting.gpuComputeVM.enabled,
    renderBundles: featureRouting.renderBundles.enabled,
  };
}

export function createMilkdropWebGPURendererAdapter(
  config: MilkdropWebGPURendererAdapterConfig,
) {
  const usesNativeWebGpuRenderer = config.renderer?.isWebGPURenderer === true;
  if (usesNativeWebGpuRenderer && config.renderer) {
    // MilkDrop's presentation pass is a fullscreen 2D composite. Disabling
    // the unused default depth attachment also prevents WebGPU from pairing a
    // stale depth texture with a newly resized canvas during adaptive-quality
    // changes.
    config.renderer.depth = false;
  }
  const useSafeWebGpuPath = shouldUseSafeMilkdropWebGpuPath();
  const enableNativeWebGpuFeedback =
    usesNativeWebGpuRenderer && shouldEnableNativeMilkdropWebGpuFeedback();
  const webgpuOptimizationFlags = usesNativeWebGpuRenderer
    ? {
        ...applyNativeWebGpuMaterialCompatibilityFlags({
          ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
          ...config.webgpuOptimizationFlags,
        }),
        directFeedbackShaders: enableNativeWebGpuFeedback,
      }
    : useSafeWebGpuPath
      ? buildSafeWebGpuOptimizationFlags(config.webgpuOptimizationFlags)
      : config.webgpuOptimizationFlags;
  const executionPlan = resolveMilkdropRendererExecutionPlan({
    backend: 'webgpu',
    safeWebGpuPath: useSafeWebGpuPath,
    nativeWebGpuFeedbackEnabled: enableNativeWebGpuFeedback,
    flags: {
      ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
      ...webgpuOptimizationFlags,
    },
  });

  return createMilkdropRendererAdapterCore({
    ...config,
    backend: 'webgpu',
    behavior: WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
    createFeedbackManager:
      executionPlan.feedbackMode === 'webgpu-native'
        ? createMilkdropWebGPUFeedbackManager
        : undefined,
    // The native WebGPU renderer can't compile the GLSL batching materials,
    // so it gets a shapes+borders-only batcher built on NodeMaterial/TSL
    // (waves stay on the native procedural TSL paths).
    batcher: usesNativeWebGpuRenderer
      ? createNativeWebGPUShapeBatchingLayer(
          createNativeWebGpuShapeBatchMaterialFactory(),
        )
      : createWebGPUBatchingLayer(),
    webgpuOptimizationFlags,
  });
}
