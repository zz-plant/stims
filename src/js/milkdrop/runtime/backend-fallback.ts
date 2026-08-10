import { isCompatibilityModeEnabled } from '../../core/render-preferences.ts';
import { markPresetNeedsWebgl } from '../../core/state/preset-webgl-fallback.ts';
import { shouldFallbackMilkdropPresetToWebgl } from '../renderer-execution-plan.ts';
import type { MilkdropCompiledPreset } from '../types.ts';
import {
  shouldEnableNativeMilkdropWebGpuFeedback,
  shouldUseSafeMilkdropWebGpuPath,
} from '../webgpu-query-override.ts';

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
  // The fallback decision must see the same feedback capability the adapter
  // will actually run with — deciding with native feedback assumed off used
  // to reload every feedback preset into WebGL even though the TSL feedback
  // manager renders it natively.
  return shouldFallbackMilkdropPresetToWebgl({
    backend: activeBackend,
    compatibilityMode: isCompatibilityModeEnabled(),
    descriptorPlan: compiled.ir.compatibility.gpuDescriptorPlans.webgpu,
    flags: webgpuOptimizationFlags,
    nativeWebGpuFeedbackEnabled: shouldEnableNativeMilkdropWebGpuFeedback(),
    safeWebGpuPath: shouldUseSafeMilkdropWebGpuPath(),
  });
}

export function createMilkdropBackendFailover({
  preferences,
  reload,
}: {
  preferences: {
    recordFallback(args: { presetId: string; reason: string }): void;
  };
  reload: (presetId: string) => void;
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
      // Scope the fallback to this preset for this session. Flipping the global
      // compatibility-mode preference here would persist a device-wide WebGL
      // downgrade for every future preset and session.
      markPresetNeedsWebgl(presetId);
      reload(presetId);
      return true;
    },
    hasTriggered() {
      return fallbackTriggered;
    },
  };
}
