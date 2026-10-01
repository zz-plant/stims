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

/**
 * What an agent needs to know after editing preset code, and could not learn
 * before: whether the source compiled, what went wrong and on which line, and
 * — critically — whether the stage is still rendering the *previous* good
 * compile rather than the source just sent. Without `renderingFallback` a
 * failed edit is indistinguishable from a successful one, because the picture
 * keeps moving either way.
 */
export interface AgentEditorDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  line?: number;
  field?: string;
}

export interface AgentEditorState {
  /** Preset the editor buffer belongs to. */
  presetId: string | null;
  /** Title parsed from the source currently in the buffer. */
  title: string | null;
  /** Buffer differs from the compiled-and-formatted source. */
  dirty: boolean;
  errorCount: number;
  warningCount: number;
  diagnostics: AgentEditorDiagnostic[];
  /** True when the latest source failed to compile and the stage is still
   * showing the last good compile instead. */
  renderingFallback: boolean;
  /** Title of what is actually on screen — differs from `title` while
   * `renderingFallback` is true. */
  renderedTitle: string | null;
  sourceLength: number;
}

/**
 * Audio sources an embedding page can start by message. The others need the
 * viewer: 'file' plays a file they pick, and tab or YouTube capture opens a
 * screen-share prompt that only a click inside the page may open.
 */
export type AgentAudioSource = 'demo' | 'microphone';

/**
 * A command's outcome, posted back as `toil:status`. `success` is true only
 * once the effect has landed; otherwise `reason` says what stopped it.
 */
export type AgentCommandResult = {
  success: boolean;
  reason?: string;
} & Record<string, unknown>;

export type AgentBridgeCommand =
  | { type: 'toil:load_preset'; presetId?: string; milkSource?: string }
  | { type: 'toil:apply_tweak'; tweak: string }
  | { type: 'toil:set_audio'; source: AgentAudioSource }
  | { type: 'toil:request_telemetry' }
  | { type: 'toil:midi_set'; target: string; value: number }
  | { type: 'toil:midi_cc'; cc: number; value: number }
  | { type: 'toil:apply_source'; source: string }
  | { type: 'toil:set_fields'; fields: Record<string, number | string> };

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
      /** Current editor/compile state. Null before the engine is mounted. */
      getEditorState: () => AgentEditorState | null;
      /** Numeric fields of the preset currently rendering, straight from the
       * compiled IR — the real values, not scraped inspector markup. */
      getEditorFields: () => Record<string, number> | null;
      /** Applies preset source and resolves once it has compiled, so the
       * caller sees real diagnostics rather than a fixed sleep. */
      applyEditorSource: (source: string) => Promise<AgentEditorState | null>;
      /** Applies a group of fields in one commit — the atomic counterpart to
       * repeated single-field sets, which can interleave. */
      applyEditorFields: (
        updates: Record<string, number | string>,
      ) => Promise<AgentEditorState | null>;
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
      /** Start the simulation clock here (seconds) so a capture repeats. */
      startTime?: number;
      beatPulse?: boolean;
      stimulus?: {
        spec: import('../core/testing/synthetic-stimulus.ts').StimulusSpec;
        frameOffset?: number;
        totalFrames?: number;
      };
      /** Pump the audio a projectM parity reference was rendered against. */
      referenceAudio?: 'silence' | 'tones';
      /** Freeze on the last pumped frame until `resumePreview()`. */
      holdAfterPump?: boolean;
      relationshipLock?: boolean;
    }) => { rendered: number } | null;
    /**
     * Agent-mode only: stop every render driver (preview loop and the
     * audio-driven animation loop) so a capture harness can screenshot the
     * exact frame it pumped. Released by resuming the preview.
     */
    __STIMS_AGENT_FREEZE_RENDERING__?: () => void;
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

/**
 * Projects an editor session state into the flat, structured-clone-safe shape
 * an out-of-process agent reads. Kept here rather than in the MCP server so
 * the "did my edit actually land" contract has exactly one definition.
 */
export function toAgentEditorState(state: {
  source: string;
  dirty: boolean;
  diagnostics: AgentEditorDiagnostic[];
  latestCompiled: { title: string; source: { id: string } } | null;
  activeCompiled: { title: string; source: { id: string } } | null;
}): AgentEditorState {
  const diagnostics = state.diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    line: diagnostic.line,
    field: diagnostic.field,
  }));
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  return {
    presetId: state.latestCompiled?.source.id ?? null,
    title: state.latestCompiled?.title ?? null,
    dirty: state.dirty,
    errorCount,
    warningCount: diagnostics.filter((d) => d.severity === 'warning').length,
    diagnostics,
    // The session swaps in the last good compile whenever the newest source
    // has errors; that substitution is the thing agents kept missing.
    renderingFallback:
      errorCount > 0 && state.activeCompiled !== state.latestCompiled,
    renderedTitle: state.activeCompiled?.title ?? null,
    sourceLength: state.source.length,
  };
}

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

export interface AgentBridgeCallbacks {
  onLoadPreset?: (payload: { presetId?: string; milkSource?: string }) => void;
  /** Resolves once the tweak has been applied and compiled, or refused. */
  onApplyTweak?: (tweak: string) => Promise<AgentCommandResult>;
  /** Resolves once the stage is playing `source`, or the start failed. */
  onSetAudio?: (source: AgentAudioSource) => Promise<AgentCommandResult>;
  /** Claude (via an MCP session_midi_set call) asking for a target by
   * name — e.g. "warp" — with a value already in that target's range. */
  onMidiSet?: (target: string, value: number) => void;
  /** Claude sending a raw CC-shaped control change, resolved through
   * whatever mapping the "Claude (MCP)" virtual device currently has. */
  onMidiCc?: (cc: number, value: number) => void;
  getMidiBindings?: () => Record<string, unknown>;
  getMidiDevices?: () => unknown[];
  getEditorState?: () => AgentEditorState | null;
  getEditorFields?: () => Record<string, number> | null;
  applyEditorSource?: (source: string) => Promise<AgentEditorState | null>;
  applyEditorFields?: (
    updates: Record<string, number | string>,
  ) => Promise<AgentEditorState | null>;
}

/** Messages this bridge posts itself. Never answered, so a bridge that
 * hears its own replies (same window, nested frames) cannot echo forever. */
const REPLY_TYPES: readonly string[] = [
  'toil:status',
  'toil:telemetry',
  'toil:editor_state',
];

const AUDIO_SOURCE_REFUSALS: Record<string, string> = {
  file: 'needs a file the viewer picks inside the page',
  tab: 'opens a screen-share prompt, which only a click inside the page may open',
  youtube:
    'opens a screen-share prompt, which only a click inside the page may open',
};

function describeAudioSourceRefusal(source: unknown): string {
  const hint = 'Send source "demo" or "microphone".';
  if (typeof source !== 'string' || !source) {
    return `source is required. ${hint}`;
  }
  return `"${source}" ${AUDIO_SOURCE_REFUSALS[source] ?? 'is not an audio source'}. ${hint}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Null means the engine is not mounted, so nothing was applied. */
function describeEditorOutcome(state: AgentEditorState | null) {
  if (!state) {
    return {
      success: false,
      reason: 'The visualizer is not running yet, so nothing was applied.',
      state,
    };
  }
  return { success: state.errorCount === 0, state };
}

export function initAgentBridge(callbacks?: AgentBridgeCallbacks): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  window.__STIMS_AGENT_TELEMETRY__ = activeTelemetry;
  window.__STIMS_AGENT_BRIDGE__ = {
    updateTelemetry: updateAgentTelemetry,
    getTelemetry: getAgentTelemetry,
    getMidiBindings: () => callbacks?.getMidiBindings?.() ?? {},
    getMidiDevices: () => callbacks?.getMidiDevices?.() ?? [],
    getEditorState: () => callbacks?.getEditorState?.() ?? null,
    getEditorFields: () => callbacks?.getEditorFields?.() ?? null,
    applyEditorSource: async (source) =>
      (await callbacks?.applyEditorSource?.(source)) ?? null,
    applyEditorFields: async (updates) =>
      (await callbacks?.applyEditorFields?.(updates)) ?? null,
  };

  const replyStatus = (
    action: string,
    result: AgentCommandResult,
    context: Record<string, unknown> = {},
  ) => {
    postAgentMessage({ type: 'toil:status', action, ...context, ...result });
  };

  /** Runs an async command and reports what actually happened. An unwired
   * callback is a refusal, never a silent success. */
  const settleStatus = (
    action: string,
    context: Record<string, unknown>,
    run: (() => Promise<AgentCommandResult>) | undefined,
  ) => {
    if (!run) {
      replyStatus(
        action,
        { success: false, reason: `${action} is not available on this page.` },
        context,
      );
      return;
    }
    void run().then(
      (result) => replyStatus(action, result, context),
      (error) =>
        replyStatus(
          action,
          { success: false, reason: describeError(error) },
          context,
        ),
    );
  };

  const settleEditor = (
    action: string,
    run: (() => Promise<AgentEditorState | null>) | undefined,
  ) => {
    const reply = (outcome: Record<string, unknown>) =>
      postAgentMessage({ type: 'toil:editor_state', action, ...outcome });
    if (!run) {
      reply({
        success: false,
        reason: `${action} is not available on this page.`,
        state: null,
      });
      return;
    }
    void run().then(
      (state) => reply(describeEditorOutcome(state)),
      (error) =>
        reply({ success: false, reason: describeError(error), state: null }),
    );
  };

  const handleMessage = (event: MessageEvent) => {
    if (!event.data || typeof event.data !== 'object') {
      return;
    }

    const data = event.data as AgentBridgeCommand;

    switch (data.type) {
      case 'toil:load_preset': {
        const presetId =
          typeof data.presetId === 'string' && data.presetId
            ? data.presetId
            : undefined;
        const milkSource =
          typeof data.milkSource === 'string' && data.milkSource
            ? data.milkSource
            : undefined;
        const onLoadPreset = callbacks?.onLoadPreset;
        if (!presetId && !milkSource) {
          replyStatus('load_preset', {
            success: false,
            reason: 'Send presetId (a catalog id) or milkSource (preset code).',
          });
          break;
        }
        if (!onLoadPreset) {
          replyStatus(
            'load_preset',
            {
              success: false,
              reason: 'load_preset is not available on this page.',
            },
            { presetId },
          );
          break;
        }
        onLoadPreset({ presetId, milkSource });
        replyStatus('load_preset', { success: true }, { presetId });
        break;
      }

      case 'toil:apply_tweak': {
        const tweak = typeof data.tweak === 'string' ? data.tweak.trim() : '';
        if (!tweak) {
          replyStatus('apply_tweak', {
            success: false,
            reason:
              'tweak must describe the change in words, e.g. "faster motion".',
          });
          break;
        }
        const onApplyTweak = callbacks?.onApplyTweak;
        settleStatus(
          'apply_tweak',
          { tweak },
          onApplyTweak && (() => onApplyTweak(tweak)),
        );
        break;
      }

      case 'toil:set_audio': {
        const source: unknown = data.source;
        if (source !== 'demo' && source !== 'microphone') {
          replyStatus(
            'set_audio',
            { success: false, reason: describeAudioSourceRefusal(source) },
            { source },
          );
          break;
        }
        const onSetAudio = callbacks?.onSetAudio;
        settleStatus(
          'set_audio',
          { source },
          onSetAudio && (() => onSetAudio(source)),
        );
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

      case 'toil:apply_source': {
        if (typeof data.source === 'string') {
          const source = data.source;
          const apply = callbacks?.applyEditorSource;
          settleEditor('apply_source', apply && (() => apply(source)));
        }
        break;
      }

      case 'toil:set_fields': {
        if (data.fields && typeof data.fields === 'object') {
          const fields = data.fields;
          const apply = callbacks?.applyEditorFields;
          settleEditor('set_fields', apply && (() => apply(fields)));
        }
        break;
      }

      default: {
        // Anything else namespaced to this protocol is a command this page
        // does not have. Say so, rather than leave the sender waiting.
        const type: unknown = (event.data as { type?: unknown }).type;
        if (
          typeof type === 'string' &&
          type.startsWith('toil:') &&
          !REPLY_TYPES.includes(type)
        ) {
          replyStatus(type.slice('toil:'.length), {
            success: false,
            reason: `Unknown message type "${type}".`,
          });
        }
        break;
      }
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
