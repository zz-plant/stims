import { markPresetNeedsWebgl } from '../../core/state/preset-webgl-fallback.ts';
import { isCompatibilityModeEnabled } from '../../core/state/render-preference-store.ts';
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

/**
 * The sentence shown when a preset is moved off WebGPU.
 *
 * Three call sites reach the failover — preset navigation, engine attachment
 * and the editor-session subscriber — and each used to inline its own copy of
 * this string. They had already drifted: only navigation appended the
 * descriptor reasons, so the same downgrade explained itself differently
 * depending on which path noticed it.
 */
export function describeWebglFallback(compiled: MilkdropCompiledPreset) {
  const unsupported =
    compiled.ir?.compatibility?.gpuDescriptorPlans?.webgpu?.unsupported ?? [];
  const detail =
    unsupported.length > 0
      ? `: ${unsupported.map((item) => item.reason).join('; ')}`
      : '';

  return `${compiled.title} uses preset features the WebGPU runtime does not support yet${detail}, so Stims switched to WebGL compatibility mode.`;
}

export function createMilkdropBackendFailover({
  preferences,
  reload,
  persistFallback = markPresetNeedsWebgl,
}: {
  preferences: {
    recordFallback(args: { presetId: string; reason: string }): void;
  };
  reload: (presetId: string) => void;
  /**
   * Test seam. Injected rather than module-mocked: `mock.module` here leaks
   * across the whole Bun run and perturbs unrelated compiler suites.
   */
  persistFallback?: (presetId: string) => boolean;
}) {
  // Guards against re-entry within one runtime. It deliberately does NOT guard
  // the reload loop: the reload tears this closure down and the next page load
  // builds a fresh one with the latch clear. Only `markPresetNeedsWebgl`
  // succeeding breaks that cycle.
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
      if (!persistFallback(presetId)) {
        // The reload's whole purpose is to re-enter with this preset pinned to
        // WebGL. Unpersisted, it re-enters pinned to nothing and lands right
        // back here, so reloading is not a degraded outcome — it is an
        // unbounded reload loop with no user escape. Stay on the WebGPU path
        // instead: this preset renders wrong, every other one still works, and
        // the tab remains usable.
        console.warn(
          `Could not persist the WebGL fallback for ${presetId} (session storage unavailable); staying on WebGPU rather than reloading indefinitely.`,
        );
        return true;
      }
      reload(presetId);
      return true;
    },
  };
}
