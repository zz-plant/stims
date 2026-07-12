import { recordRendererOptimizationTelemetry } from '../core/renderer-capabilities.ts';
import type {
  MilkdropGpuDescriptorRouting,
  MilkdropRenderBackend,
  MilkdropWebGpuDescriptorPlan,
} from './types.ts';
import {
  applyMilkdropWebGpuOptimizationFlags,
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  type MilkdropWebGpuOptimizationFlags,
} from './webgpu-optimization-flags.ts';

export type MilkdropWebGpuExecutionPath = 'safe' | 'full';

export type MilkdropFeedbackExecutionMode =
  | 'none'
  | 'webgl-shared'
  | 'webgpu-native';

export type MilkdropRendererExecutionPlan = {
  backend: MilkdropRenderBackend;
  webgpuPath: MilkdropWebGpuExecutionPath | null;
  feedbackMode: MilkdropFeedbackExecutionMode;
  effectiveWebGpuDescriptorPlan: MilkdropWebGpuDescriptorPlan | null;
  descriptorRouting: MilkdropGpuDescriptorRouting | null;
  shouldFallbackToWebgl: boolean;
  fallbackReason: 'descriptor-plan' | null;
};

export function resolveMilkdropRendererExecutionPlan({
  backend,
  compatibilityMode = false,
  descriptorPlan = null,
  flags = DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  safeWebGpuPath = false,
}: {
  backend: MilkdropRenderBackend;
  compatibilityMode?: boolean;
  descriptorPlan?: MilkdropWebGpuDescriptorPlan | null;
  flags?: MilkdropWebGpuOptimizationFlags;
  safeWebGpuPath?: boolean;
}): MilkdropRendererExecutionPlan {
  const effectiveWebGpuDescriptorPlan =
    backend === 'webgpu' && descriptorPlan
      ? applyMilkdropWebGpuOptimizationFlags(descriptorPlan, flags)
      : null;
  const shouldFallbackToWebgl =
    backend === 'webgpu' &&
    !compatibilityMode &&
    effectiveWebGpuDescriptorPlan?.routing === 'fallback-webgl';

  return {
    backend,
    webgpuPath:
      backend === 'webgpu' ? (safeWebGpuPath ? 'safe' : 'full') : null,
    feedbackMode: backend === 'webgl' ? 'webgl-shared' : 'none',
    effectiveWebGpuDescriptorPlan,
    descriptorRouting: effectiveWebGpuDescriptorPlan?.routing ?? null,
    shouldFallbackToWebgl,
    fallbackReason: shouldFallbackToWebgl ? 'descriptor-plan' : null,
  };
}

export function shouldFallbackMilkdropPresetToWebgl({
  backend,
  compatibilityMode,
  descriptorPlan,
  flags,
}: {
  backend: MilkdropRenderBackend;
  compatibilityMode: boolean;
  descriptorPlan: MilkdropWebGpuDescriptorPlan;
  flags: MilkdropWebGpuOptimizationFlags;
}) {
  const plan = resolveMilkdropRendererExecutionPlan({
    backend,
    compatibilityMode,
    descriptorPlan,
    flags,
  });

  if (plan.shouldFallbackToWebgl) {
    recordRendererOptimizationTelemetry({
      counter: 'milkdropWebGpuFallbackRouting',
    });
  }
  return plan.shouldFallbackToWebgl;
}
