import type { AdaptiveQualityState } from '../../core/services/adaptive-quality-controller.ts';
import type { ToyRuntimeInstance } from '../../core/toy-runtime.ts';
import type { MilkdropRendererAdapter } from '../renderer-types.ts';
import type {
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropRuntimeSignals,
} from '../types.ts';

function sanitizeRuntimeSignals(signals: MilkdropRuntimeSignals) {
  const {
    frequencyData: _frequencyData,
    waveformData: _waveformData,
    ...rest
  } = signals;
  return rest;
}

export function buildAgentMilkdropDebugSnapshot({
  activePresetId,
  compiledPreset,
  frameState,
  status,
  adaptiveQuality,
}: {
  activePresetId: string | null;
  compiledPreset: MilkdropCompiledPreset | null;
  frameState: MilkdropFrameState | null;
  status: string | null;
  adaptiveQuality?: AdaptiveQualityState | null;
}) {
  if (!frameState) {
    return {
      activePresetId,
      status,
      adaptiveQuality,
      frameState: null,
      title: compiledPreset?.title ?? null,
    };
  }

  return {
    activePresetId,
    status,
    adaptiveQuality,
    title: compiledPreset?.title ?? frameState.title,
    frameState: {
      presetId: frameState.presetId,
      title: frameState.title,
      signals: sanitizeRuntimeSignals(frameState.signals),
      variables: frameState.variables,
      mainWave: frameState.mainWave,
      shapes: frameState.shapes,
      post: frameState.post,
    },
  };
}

export function registerAgentMilkdropRuntimeDebugHandle({
  isAgentMode,
  getRuntime,
  getAdapter,
  getState,
}: {
  isAgentMode: () => boolean;
  getRuntime: () => ToyRuntimeInstance | null;
  getAdapter: () => MilkdropRendererAdapter | null;
  getState: () => {
    activePresetId: string;
    backend: 'webgl' | 'webgpu';
    status: string | null;
  };
}) {
  if (typeof window === 'undefined' || !isAgentMode()) {
    return;
  }

  (
    window as Window & {
      __milkdropRuntimeDebug?: {
        getRuntime: () => ToyRuntimeInstance | null;
        getAdapter: () => MilkdropRendererAdapter | null;
        getState: () => {
          activePresetId: string;
          backend: 'webgl' | 'webgpu';
          status: string | null;
        };
      };
    }
  ).__milkdropRuntimeDebug = {
    getRuntime,
    getAdapter,
    getState,
  };
}
