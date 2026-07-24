import { recordRendererOptimizationTelemetry } from '../core/renderer-capabilities.ts';
import type {
  MilkdropGpuDescriptorRouting,
  MilkdropRenderBackend,
  MilkdropWebGpuDescriptorPlan,
} from './types.ts';
import {
  applyMilkdropWebGpuOptimizationFlags,
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  type MilkdropWebGpuOptimizationFlagName,
  type MilkdropWebGpuOptimizationFlags,
} from './webgpu-optimization-flags.ts';

export type MilkdropWebGpuExecutionPath = 'safe' | 'full';

export type MilkdropFeedbackExecutionMode =
  | 'none'
  | 'webgl-shared'
  | 'webgpu-native';

export type MilkdropRendererFallbackReason =
  | 'descriptor-feedback'
  | 'descriptor-plan';

export type MilkdropRendererDisabledFeature = {
  feature: MilkdropWebGpuOptimizationFlagName;
  reason: 'native-webgpu-feedback-disabled' | 'safe-webgpu-path';
};

export type MilkdropRendererExecutionPlan = {
  backend: MilkdropRenderBackend;
  webgpuPath: MilkdropWebGpuExecutionPath | null;
  feedbackMode: MilkdropFeedbackExecutionMode;
  effectiveWebGpuDescriptorPlan: MilkdropWebGpuDescriptorPlan | null;
  descriptorRouting: MilkdropGpuDescriptorRouting | null;
  shouldFallbackToWebgl: boolean;
  fallbackReason: MilkdropRendererFallbackReason | null;
  disabledFeatures: MilkdropRendererDisabledFeature[];
  statusLabels: string[];
};

export function resolveMilkdropRendererExecutionPlan({
  backend,
  compatibilityMode = false,
  descriptorPlan = null,
  flags = DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  nativeWebGpuFeedbackEnabled = false,
  safeWebGpuPath = false,
}: {
  backend: MilkdropRenderBackend;
  compatibilityMode?: boolean;
  descriptorPlan?: MilkdropWebGpuDescriptorPlan | null;
  flags?: MilkdropWebGpuOptimizationFlags;
  nativeWebGpuFeedbackEnabled?: boolean;
  safeWebGpuPath?: boolean;
}): MilkdropRendererExecutionPlan {
  const disabledFeatures: MilkdropRendererDisabledFeature[] = [];
  const statusLabels: string[] = [];
  const canUseNativeWebGpuFeedback =
    backend === 'webgpu' && !safeWebGpuPath && nativeWebGpuFeedbackEnabled;
  const feedbackMode: MilkdropFeedbackExecutionMode =
    backend === 'webgl'
      ? 'webgl-shared'
      : canUseNativeWebGpuFeedback
        ? 'webgpu-native'
        : 'none';

  if (backend === 'webgpu' && flags.directFeedbackShaders) {
    if (safeWebGpuPath) {
      disabledFeatures.push({
        feature: 'directFeedbackShaders',
        reason: 'safe-webgpu-path',
      });
    } else if (!nativeWebGpuFeedbackEnabled) {
      disabledFeatures.push({
        feature: 'directFeedbackShaders',
        reason: 'native-webgpu-feedback-disabled',
      });
      statusLabels.push('WebGPU native feedback disabled');
    }
  }

  const effectiveFlags: MilkdropWebGpuOptimizationFlags =
    backend === 'webgpu' && !canUseNativeWebGpuFeedback
      ? { ...flags, directFeedbackShaders: false }
      : flags;
  const effectiveWebGpuDescriptorPlan =
    backend === 'webgpu' && descriptorPlan
      ? applyMilkdropWebGpuOptimizationFlags(descriptorPlan, effectiveFlags)
      : null;
  const shouldFallbackToWebgl =
    backend === 'webgpu' &&
    !compatibilityMode &&
    effectiveWebGpuDescriptorPlan?.routing === 'fallback-webgl';
  const fallbackReason = shouldFallbackToWebgl
    ? descriptorPlan?.feedback
      ? 'descriptor-feedback'
      : 'descriptor-plan'
    : null;
  if (fallbackReason === 'descriptor-feedback') {
    statusLabels.push('WebGPU descriptor feedback fallback');
  } else if (fallbackReason === 'descriptor-plan') {
    statusLabels.push('WebGPU descriptor plan fallback');
  }

  return {
    backend,
    webgpuPath:
      backend === 'webgpu' ? (safeWebGpuPath ? 'safe' : 'full') : null,
    feedbackMode,
    effectiveWebGpuDescriptorPlan,
    descriptorRouting: effectiveWebGpuDescriptorPlan?.routing ?? null,
    shouldFallbackToWebgl,
    fallbackReason,
    disabledFeatures,
    statusLabels,
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
