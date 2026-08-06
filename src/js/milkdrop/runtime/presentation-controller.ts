import type { AdaptiveQualityState } from '../../core/services/adaptive-quality-controller.ts';
import type { MilkdropRendererAdapter } from '../renderer-types.ts';
import type { MilkdropCompiledPreset, MilkdropFrameState } from '../types.ts';
import { buildAgentMilkdropDebugSnapshot } from './debug-snapshot.ts';
import type { MilkdropRuntimePerformanceSnapshot } from './performance-tracker.ts';
import type { ReturnTypeOfCreateMilkdropVM } from './presentation-types.ts';

type PresentationState = {
  activePresetId: string;
  compiledPreset: MilkdropCompiledPreset;
  frameState: MilkdropFrameState | null;
  backend: 'webgl' | 'webgpu';
  status: string | null;
  adaptiveQuality: AdaptiveQualityState | null;
};

export function createMilkdropPresentationController({
  vm,
  getAdapter,
  getState,
  setCompiledState,
  isAgentMode,
  setDebugSnapshot,
  getPerformanceMetrics,
}: {
  vm: ReturnTypeOfCreateMilkdropVM;
  getAdapter: () => MilkdropRendererAdapter | null;
  getState: () => PresentationState;
  setCompiledState: (compiled: MilkdropCompiledPreset) => void;
  isAgentMode: () => boolean;
  setDebugSnapshot: (tool: string, snapshot: unknown) => void;
  getPerformanceMetrics: () => MilkdropRuntimePerformanceSnapshot | null;
}) {
  const DEBUG_SNAPSHOT_INTERVAL_MS = 60;
  let lastDebugSnapshotAt = 0;

  const updateAgentDebugSnapshot = (
    force = false,
    renderFrameStateOverride?: MilkdropFrameState | null,
  ) => {
    if (!isAgentMode()) {
      return;
    }

    const now = performance.now();
    if (!force && now - lastDebugSnapshotAt < DEBUG_SNAPSHOT_INTERVAL_MS) {
      return;
    }
    lastDebugSnapshotAt = now;

    const state = getState();
    setDebugSnapshot(
      'milkdrop',
      buildAgentMilkdropDebugSnapshot({
        activePresetId: state.activePresetId,
        compiledPreset: state.compiledPreset,
        frameState: renderFrameStateOverride ?? state.frameState,
        status: state.status,
        adaptiveQuality: state.adaptiveQuality,
        performance: getPerformanceMetrics(),
      }),
    );
  };

  const setOverlayStatus = () => {
    updateAgentDebugSnapshot(true);
  };

  const applyCompiledPreset = (compiled: MilkdropCompiledPreset) => {
    setCompiledState(compiled);
    const state = getState();
    vm.setPreset(compiled);
    vm.setRenderBackend(state.backend);
    getAdapter()?.setPreset(compiled);
    updateAgentDebugSnapshot(true);
  };

  return {
    applyCompiledPreset,
    setOverlayStatus,
    updateAgentDebugSnapshot,
  };
}
