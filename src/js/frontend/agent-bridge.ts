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
  | { type: 'toil:request_telemetry' };

declare global {
  interface Window {
    __STIMS_AGENT_TELEMETRY__?: AgentTelemetry;
    __STIMS_AGENT_BRIDGE__?: {
      updateTelemetry: (data: Partial<AgentTelemetry>) => void;
      getTelemetry: () => AgentTelemetry;
    };
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
}): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  window.__STIMS_AGENT_TELEMETRY__ = activeTelemetry;
  window.__STIMS_AGENT_BRIDGE__ = {
    updateTelemetry: updateAgentTelemetry,
    getTelemetry: getAgentTelemetry,
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
