import {
  isCompatibilityModeEnabled,
  setCompatibilityMode,
} from '../../core/render-preferences.ts';
import type { MilkdropCompiledPreset } from '../types.ts';
import { shouldFallbackMilkdropPresetToWebgl } from '../webgpu-optimization-flags.ts';

export function shouldPresetFallbackToWebgl({
  compiled,
  activeBackend,
  webgpuOptimizationFlags,
}: {
  compiled: MilkdropCompiledPreset;
  activeBackend: 'webgl' | 'webgpu';
  webgpuOptimizationFlags: ReturnType<
    typeof import('../webgpu-optimization-flags.ts').resolveMilkdropWebGpuOptimizationFlags
  >;
}) {
  return shouldFallbackMilkdropPresetToWebgl({
    backend: activeBackend,
    compatibilityMode: isCompatibilityModeEnabled(),
    descriptorPlan: compiled.ir.compatibility.gpuDescriptorPlans.webgpu,
    flags: webgpuOptimizationFlags,
  });
}

export function createMilkdropBackendFailover({
  preferences,
  reload,
}: {
  preferences: {
    recordFallback(args: { presetId: string; reason: string }): void;
  };
  reload: () => void;
}) {
  let fallbackTriggered = false;

  return {
    shouldFallback: shouldPresetFallbackToWebgl,
    trigger({
      presetId,
      reason,
      activeBackend,
    }: {
      presetId: string;
      reason: string;
      activeBackend: 'webgl' | 'webgpu';
    }) {
      if (fallbackTriggered || activeBackend !== 'webgpu') {
        return false;
      }
      fallbackTriggered = true;
      preferences.recordFallback({ presetId, reason });
      setCompatibilityMode(true);
      reload();
      return true;
    },
    hasTriggered() {
      return fallbackTriggered;
    },
  };
}
