/**
 * What the iframe bridge's commands do in this app. Kept out of the shell so
 * each command can be driven by a test that posts the real message, without
 * mounting the whole workspace.
 *
 * A command that cannot finish says why. `toil:apply_tweak` once replayed the
 * active preset and reported success, and `toil:set_audio` reported success
 * with no handler behind it at all.
 */
import type { RefObject } from 'react';
import {
  VIRTUAL_CLAUDE_DEVICE_ID,
  webMidiService,
} from '../core/services/webmidi-controller.ts';
import {
  type AgentAudioSource,
  type AgentBridgeCallbacks,
  type AgentCommandResult,
  toAgentEditorState,
} from './agent-bridge.ts';
import { getStatusLog, waitForCommittedCore } from './agent-state.ts';
import type { EngineSnapshot } from './engine/engine-snapshot.ts';
import type { EngineContextValue } from './engine-context.tsx';

/**
 * The start path awaits the engine mount itself, so this only covers React
 * committing the new source afterwards. A failed start never commits it, so
 * this is also how long a refusal takes to come back.
 */
const AUDIO_COMMIT_TIMEOUT_MS = 2000;

async function startAudioForAgent(
  engine: EngineContextValue,
  source: AgentAudioSource,
  timeoutMs: number,
): Promise<AgentCommandResult> {
  const startedAt = Date.now();
  // The same start path the audio source panel's buttons take.
  await engine.handleAudioStart(source);
  const committed = await waitForCommittedCore(
    (core) => core.liveMode && core.audioSource === source,
    timeoutMs,
  );
  if (committed) return { success: true };
  // The start path reports its failures (permission denied, no device) as a
  // status message rather than a throw.
  const failure = getStatusLog()
    .filter((entry) => entry.at >= startedAt)
    .at(-1)?.message;
  return {
    success: false,
    reason: failure ?? `The ${source} audio source did not start.`,
  };
}

async function applyTweakForAgent(
  engine: EngineContextValue,
  currentSource: string,
  tweak: string,
): Promise<AgentCommandResult> {
  if (!currentSource) {
    return {
      success: false,
      reason: 'No preset is loaded yet, so there is nothing to tweak.',
    };
  }
  // Loaded on demand: the restyle tables are only needed once someone tweaks.
  const { refinePresetSource, REFINE_FALLBACK_KEYWORDS } = await import(
    './preset-refine.ts'
  );
  const refinement = await refinePresetSource(currentSource, tweak);
  if (refinement.method === 'none') {
    return {
      success: false,
      reason: `AI refine is unavailable (${refinement.aiError}), and without it a tweak must name one of: ${REFINE_FALLBACK_KEYWORDS.join(', ')}.`,
    };
  }
  const how =
    refinement.method === 'ai'
      ? { method: 'ai' }
      : {
          method: 'restyle',
          restyle: refinement.style,
          note: `AI refine is unavailable (${refinement.aiError}), so the ${refinement.label} restyle was applied instead.`,
        };
  const session = await engine.applyEditorSourceAwaited(refinement.milkSource);
  if (!session) {
    return {
      success: false,
      reason:
        'The visualizer is not running yet, so the tweak was not applied.',
      ...how,
    };
  }
  const state = toAgentEditorState(session);
  if (state.errorCount > 0) {
    return {
      success: false,
      reason:
        'The tweaked preset failed to compile, so the previous one is still on screen.',
      ...how,
      state,
    };
  }
  return { success: true, ...how, state };
}

export function buildAgentBridgeCallbacks({
  engineRef,
  engineSnapshotRef,
  audioCommitTimeoutMs = AUDIO_COMMIT_TIMEOUT_MS,
}: {
  engineRef: RefObject<EngineContextValue>;
  engineSnapshotRef: RefObject<EngineSnapshot | null>;
  audioCommitTimeoutMs?: number;
}): AgentBridgeCallbacks {
  return {
    onLoadPreset: (payload) => {
      // milkSource is how an agent hands over preset *code* rather than a
      // catalog id (MCP's session_apply_source). The bridge has always
      // forwarded it and this handler always dropped it, so that tool
      // silently did nothing.
      if (payload.milkSource) {
        engineRef.current.updateEditorSource(payload.milkSource);
        return;
      }
      if (payload.presetId) {
        void engineRef.current.handlePlayPreset(payload.presetId);
      }
    },
    onApplyTweak: (tweak) =>
      applyTweakForAgent(
        engineRef.current,
        engineSnapshotRef.current?.currentSource ?? '',
        tweak,
      ),
    onSetAudio: (source) =>
      startAudioForAgent(engineRef.current, source, audioCommitTimeoutMs),
    // Lets an MCP session_midi_set/session_midi_cc call "perform" on the
    // live stage through the exact same virtual-device pipeline a
    // physical controller uses — see webmidi-controller.ts.
    onMidiSet: (target, value) => {
      webMidiService.injectTargetValue(VIRTUAL_CLAUDE_DEVICE_ID, target, value);
    },
    onMidiCc: (cc, value) => {
      webMidiService.injectControlChange(VIRTUAL_CLAUDE_DEVICE_ID, cc, value);
    },
    getMidiBindings: () => webMidiService.getAllBindings(),
    getMidiDevices: () => webMidiService.getDevices(),
    // Read/await surface for live code editing. Without these an agent
    // could send preset source but never learn whether it compiled.
    getEditorState: () => {
      const state = engineRef.current.getEditorSessionState();
      return state ? toAgentEditorState(state) : null;
    },
    getEditorFields: () => {
      // The editor session's own latest compile, not the renderer's active
      // one. They diverge whenever rendering is paused (a hidden or headless
      // tab) or the newest source failed — and an agent reading values to
      // compute a delta needs the buffer it is actually editing.
      const compiled =
        engineRef.current.getEditorSessionState()?.latestCompiled ??
        engineRef.current.getActiveCompiledPreset();
      return compiled ? { ...compiled.ir.numericFields } : null;
    },
    applyEditorSource: async (source) => {
      const state = await engineRef.current.applyEditorSourceAwaited(source);
      return state ? toAgentEditorState(state) : null;
    },
    applyEditorFields: async (updates) => {
      const state = await engineRef.current.applyEditorFieldsAwaited(updates);
      return state ? toAgentEditorState(state) : null;
    },
  };
}
