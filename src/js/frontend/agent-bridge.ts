// Agent Bridge & Telemetry System for toil.fyi
// Handles iframe postMessage communication & quantitative telemetry reporting

/**
 * Adaptive-quality diagnostics, surfaced so on-device QA can see *why* the
 * renderer picked a resolution. Without this the only visible symptom of a
 * quality regression is "it looks soft", which is not actionable from a
 * remote debugging session.
 */
export interface AgentQualityTelemetry {
  /** Index into the controller's quality ladder; 0 is the sharpest. */
  step: number;
  stepCount: number;
  adaptation: 'steady' | 'degraded' | 'recovering' | 'enhanced';
  /** CPU work inside a frame, per the controller. */
  averageFrameMs: number | null;
  /** Frame-to-frame period, per the controller. */
  averageCadenceMs: number | null;
  frameBudgetMs: number;
  renderScaleMultiplier: number;
  maxPixelRatioMultiplier: number;
}

export interface AgentTelemetry {
  fps: number;
  backend: 'webgl' | 'webgpu' | 'unknown';
  audioEnergy: number;
  currentPresetId: string | null;
  agentMode: boolean;
  timestamp: number;
  quality: AgentQualityTelemetry | null;
}

export type AgentBridgeCommand =
  | { type: 'toil:load_preset'; presetId?: string; milkSource?: string }
  | { type: 'toil:apply_tweak'; tweak: string }
  | { type: 'toil:set_audio'; source: 'demo' | 'microphone' | 'file' }
  | { type: 'toil:request_telemetry' }
  | { type: 'toil:midi_set'; target: string; value: number }
  | { type: 'toil:midi_cc'; cc: number; value: number };

declare global {
  interface Window {
    __STIMS_AGENT_TELEMETRY__?: AgentTelemetry;
    __STIMS_AGENT_BRIDGE__?: {
      updateTelemetry: (data: Partial<AgentTelemetry>) => void;
      getTelemetry: () => AgentTelemetry;
      /** Bindings for every known MIDI device (physical + the virtual
       * "Claude (MCP)" channel), keyed by device id. */
      getMidiBindings: () => Record<string, unknown>;
      getMidiDevices: () => unknown[];
    };
    /**
     * Agent-mode only: synchronously render N frames with synthetic
     * time/audio, decoupled from wall-clock and RAF. Installed by the
     * milkdrop engine session so capture harnesses (preview generation)
     * can warm up feedback-heavy presets in GPU time instead of waiting
     * real seconds, immune to hidden-tab RAF pauses. Returns null while
     * audio is active or before the runtime is mounted.
     */
    __STIMS_AGENT_RENDER_FRAMES__?: (options?: {
      frames?: number;
      deltaMs?: number;
      beatPulse?: boolean;
    }) => { rendered: number } | null;
  }
}

let activeTelemetry: AgentTelemetry = {
  // 0 rather than a nominal 60: nothing has been measured yet, and a plausible
  // default here is what made mobile frame-rate regressions invisible.
  fps: 0,
  backend: 'webgl',
  audioEnergy: 0,
  currentPresetId: null,
  agentMode: false,
  timestamp: Date.now(),
  quality: null,
};

export function updateAgentTelemetry(
  patch: Partial<AgentTelemetry>,
): AgentTelemetry {
  activeTelemetry = {
    ...activeTelemetry,
    ...patch,
    timestamp: Date.now(),
  };

  if (typeof window !== 'undefined') {
    window.__STIMS_AGENT_TELEMETRY__ = activeTelemetry;
  }

  return activeTelemetry;
}

export function getAgentTelemetry(): AgentTelemetry {
  return activeTelemetry;
}

export function initAgentBridge(callbacks?: {
  onLoadPreset?: (payload: { presetId?: string; milkSource?: string }) => void;
  onApplyTweak?: (tweak: string) => void;
  onSetAudio?: (source: 'demo' | 'microphone' | 'file') => void;
  /** Claude (via an MCP session_midi_set call) asking for a target by
   * name — e.g. "warp" — with a value already in that target's range. */
  onMidiSet?: (target: string, value: number) => void;
  /** Claude sending a raw CC-shaped control change, resolved through
   * whatever mapping the "Claude (MCP)" virtual device currently has. */
  onMidiCc?: (cc: number, value: number) => void;
  getMidiBindings?: () => Record<string, unknown>;
  getMidiDevices?: () => unknown[];
}): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  window.__STIMS_AGENT_TELEMETRY__ = activeTelemetry;
  window.__STIMS_AGENT_BRIDGE__ = {
    updateTelemetry: updateAgentTelemetry,
    getTelemetry: getAgentTelemetry,
    getMidiBindings: () => callbacks?.getMidiBindings?.() ?? {},
    getMidiDevices: () => callbacks?.getMidiDevices?.() ?? [],
  };

  const handleMessage = (event: MessageEvent) => {
    if (!event.data || typeof event.data !== 'object') {
      return;
    }

    const data = event.data as AgentBridgeCommand;

    switch (data.type) {
      case 'toil:load_preset': {
        callbacks?.onLoadPreset?.({
          presetId: data.presetId,
          milkSource: data.milkSource,
        });
        postAgentMessage({
          type: 'toil:status',
          action: 'load_preset',
          success: true,
          presetId: data.presetId,
        });
        break;
      }

      case 'toil:apply_tweak': {
        if (data.tweak) {
          callbacks?.onApplyTweak?.(data.tweak);
          postAgentMessage({
            type: 'toil:status',
            action: 'apply_tweak',
            success: true,
            tweak: data.tweak,
          });
        }
        break;
      }

      case 'toil:set_audio': {
        if (data.source) {
          callbacks?.onSetAudio?.(data.source);
          postAgentMessage({
            type: 'toil:status',
            action: 'set_audio',
            success: true,
            source: data.source,
          });
        }
        break;
      }

      case 'toil:request_telemetry': {
        postAgentMessage({
          type: 'toil:telemetry',
          ...getAgentTelemetry(),
        });
        break;
      }

      case 'toil:midi_set': {
        if (data.target && Number.isFinite(data.value)) {
          callbacks?.onMidiSet?.(data.target, data.value);
        }
        break;
      }

      case 'toil:midi_cc': {
        if (Number.isFinite(data.cc) && Number.isFinite(data.value)) {
          callbacks?.onMidiCc?.(data.cc, data.value);
        }
        break;
      }

      default:
        break;
    }
  };

  window.addEventListener('message', handleMessage);

  return () => {
    window.removeEventListener('message', handleMessage);
  };
}

function postAgentMessage(payload: Record<string, unknown>) {
  if (
    typeof window !== 'undefined' &&
    window.parent &&
    window.parent !== window
  ) {
    window.parent.postMessage(payload, '*');
  }
}
