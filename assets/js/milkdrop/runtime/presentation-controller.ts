import type { AdaptiveQualityState } from '../../core/services/adaptive-quality-controller.ts';
import type { createMilkdropEditorSession } from '../editor-session.ts';
import type { MilkdropOverlay } from '../overlay.ts';
import type { createMilkdropRendererAdapter } from '../renderer-adapter-factory.ts';
import type { MilkdropCompiledPreset, MilkdropFrameState } from '../types.ts';
import { buildAgentMilkdropDebugSnapshot } from './debug-snapshot.ts';
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
  getOverlay,
  session,
  vm,
  getAdapter,
  getState,
  setCompiledState,
  isAgentMode,
  setDebugSnapshot,
}: {
  getOverlay: () => MilkdropOverlay | null;
  session: Pick<ReturnType<typeof createMilkdropEditorSession>, 'getState'>;
  vm: ReturnTypeOfCreateMilkdropVM;
  getAdapter: () => ReturnType<typeof createMilkdropRendererAdapter> | null;
  getState: () => PresentationState;
  setCompiledState: (compiled: MilkdropCompiledPreset) => void;
  isAgentMode: () => boolean;
  setDebugSnapshot: (tool: string, snapshot: unknown) => void;
}) {
  const updateAgentDebugSnapshot = () => {
    if (!isAgentMode()) {
      return;
    }

    const state = getState();
    setDebugSnapshot(
      'milkdrop',
      buildAgentMilkdropDebugSnapshot({
        activePresetId: state.activePresetId,
        compiledPreset: state.compiledPreset,
        frameState: state.frameState,
        status: state.status,
        adaptiveQuality: state.adaptiveQuality,
      }),
    );
  };

  const setOverlayStatus = (message: string) => {
    getOverlay()?.setStatus(message);
    updateAgentDebugSnapshot();
  };

  const applyCompiledPreset = (compiled: MilkdropCompiledPreset) => {
    setCompiledState(compiled);
    const state = getState();
    vm.setPreset(compiled);
    vm.setRenderBackend(state.backend);
    getAdapter()?.setPreset(compiled);

    const overlay = getOverlay();
    overlay?.setCurrentPresetTitle(compiled.title);
    overlay?.setSessionState(session.getState());
    overlay?.setInspectorState({
      compiled: state.compiledPreset,
      frameState: state.frameState,
      backend: state.backend,
    });
    updateAgentDebugSnapshot();
  };

  const syncInspectorState = () => {
    const overlay = getOverlay();
    if (!overlay) {
      return;
    }

    const state = getState();
    overlay.setInspectorState({
      compiled: state.compiledPreset,
      frameState: state.frameState,
      backend: state.backend,
    });
    updateAgentDebugSnapshot();
  };

  return {
    applyCompiledPreset,
    setOverlayStatus,
    syncInspectorState,
    updateAgentDebugSnapshot,
  };
}
