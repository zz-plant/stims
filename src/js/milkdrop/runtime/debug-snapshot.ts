import type { AdaptiveQualityState } from '../../core/services/adaptive-quality-controller.ts';
import type { ToyRuntimeInstance } from '../../core/toy-runtime.ts';
import type { MilkdropRendererAdapter } from '../renderer-types.ts';
import type { TraceFile } from '../trace-capture.ts';
import type {
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropRuntimeSignals,
} from '../types.ts';
import type { MilkdropRuntimePerformanceSnapshot } from './performance-tracker.ts';
import type { MilkdropPresetSelectionReason } from './startup.ts';
import type { MilkdropTraceRecorderState } from './trace-recorder.ts';

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
  performance,
}: {
  activePresetId: string | null;
  compiledPreset: MilkdropCompiledPreset | null;
  frameState: MilkdropFrameState | null;
  status: string | null;
  adaptiveQuality?: AdaptiveQualityState | null;
  performance?: MilkdropRuntimePerformanceSnapshot | null;
}) {
  if (!frameState) {
    return {
      activePresetId,
      status,
      adaptiveQuality,
      performance,
      frameState: null,
      title: compiledPreset?.title ?? null,
    };
  }

  return {
    activePresetId,
    status,
    adaptiveQuality,
    performance,
    title: compiledPreset?.title ?? frameState.title,
    frameState: {
      presetId: frameState.presetId,
      title: frameState.title,
      signals: sanitizeRuntimeSignals(frameState.signals),
      variables: frameState.variables,
      // Runtime quality policies reuse these small object shells each frame to
      // avoid hot-loop garbage. Snapshots outlive the render call, so detach
      // the shells at the 60ms agent sampling boundary instead of retaining a
      // view that silently changes under the debugger.
      mainWave: { ...frameState.mainWave },
      shapes: frameState.shapes,
      post: {
        ...frameState.post,
        postprocessingProfile: frameState.post.postprocessingProfile
          ? { ...frameState.post.postprocessingProfile }
          : frameState.post.postprocessingProfile,
      },
    },
  };
}

export type MilkdropAgentDriverHandle = {
  getRuntime: () => ToyRuntimeInstance | null;
  getAdapter: () => MilkdropRendererAdapter | null;
  getState: () => {
    activePresetId: string;
    backend: 'webgl' | 'webgpu';
    status: string | null;
    /** Why the active preset is the one showing (boot-bundle, deep-link,
     * remembered, collection, first-selectable, requested, autoplay). */
    presetSelectionReason?: MilkdropPresetSelectionReason;
  };
  getAdaptiveQuality: () => AdaptiveQualityState | null;
  getPerformance: () => MilkdropRuntimePerformanceSnapshot | null;
  /**
   * Selects a preset directly through the navigation controller, bypassing
   * the route/URL layer entirely. Resolves once the controller's own
   * supersede/fallback/error handling has settled — it does not reject on a
   * failed load (a bad id, a compile error, a superseded request all
   * resolve normally), so callers must check the return value.
   */
  selectPreset: (presetId: string) => Promise<void>;
  setAutoplay: (enabled: boolean) => void;
  /** Resolves once the runtime's own async startup preset selection has
   * finished. An agent that calls `selectPreset` before this settles can
   * have its choice silently overwritten (or vice versa) — see the
   * comment at its definition in runtime.ts. */
  startupSettled: () => Promise<void>;
  /** Live trace capture (see runtime/trace-recorder.ts). start RESETS the
   * running VM so the trace replays deterministically from frame 0. */
  startTraceCapture: (options?: {
    maxFrames?: number;
  }) => MilkdropTraceRecorderState;
  /** Ends the capture and returns the TraceFile JSON for
   * `bun run lab:replay -- --replay <file>`; null if nothing was recorded. */
  stopTraceCapture: () => TraceFile | null;
  getTraceCaptureState: () => MilkdropTraceRecorderState;
  /**
   * Transition state: phase, the controller's event ring buffer, and the
   * hand-driven fader position when one is running.
   *
   * The event log has existed since the controller was extracted and was
   * reachable from nothing — so "why did that switch cut instead of
   * blending" was unanswerable from a live session, which is exactly the
   * question a workload-gated crossfade raises.
   */
  getTransition: () => {
    phase: string;
    crossfade: number | null;
    events: ReadonlyArray<{ at: number; event: string; detail?: string }>;
  };
};

export function registerAgentMilkdropRuntimeDebugHandle({
  isAgentMode,
  getRuntime,
  getAdapter,
  getState,
  getAdaptiveQuality,
  getPerformance,
  selectPreset,
  setAutoplay,
  startupSettled,
  startTraceCapture,
  stopTraceCapture,
  getTraceCaptureState,
  getTransition,
}: {
  isAgentMode: () => boolean;
  getRuntime: () => ToyRuntimeInstance | null;
  getAdapter: () => MilkdropRendererAdapter | null;
  getState: () => {
    activePresetId: string;
    backend: 'webgl' | 'webgpu';
    status: string | null;
    /** Why the active preset is the one showing (boot-bundle, deep-link,
     * remembered, collection, first-selectable, requested, autoplay). */
    presetSelectionReason?: MilkdropPresetSelectionReason;
  };
  getAdaptiveQuality: () => AdaptiveQualityState | null;
  getPerformance: () => MilkdropRuntimePerformanceSnapshot | null;
  selectPreset: (presetId: string) => Promise<void>;
  setAutoplay: (enabled: boolean) => void;
  startupSettled: () => Promise<void>;
  startTraceCapture: (options?: {
    maxFrames?: number;
  }) => MilkdropTraceRecorderState;
  stopTraceCapture: () => TraceFile | null;
  getTraceCaptureState: () => MilkdropTraceRecorderState;
  getTransition: MilkdropAgentDriverHandle['getTransition'];
}) {
  if (typeof window === 'undefined' || !isAgentMode()) {
    return;
  }

  (
    window as Window & {
      __milkdropRuntimeDebug?: MilkdropAgentDriverHandle;
    }
  ).__milkdropRuntimeDebug = {
    getRuntime,
    getAdapter,
    selectPreset,
    setAutoplay,
    startupSettled,
    getState,
    getAdaptiveQuality,
    getPerformance,
    startTraceCapture,
    stopTraceCapture,
    getTraceCaptureState,
    getTransition,
  };
}
