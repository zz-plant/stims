/**
 * What the iframe bridge's commands do in this app. Kept out of the shell so
 * each command can be driven by a test that posts the real message, without
 * mounting the whole workspace.
 *
 * A command that cannot finish says why. `toil:apply_tweak` once replayed the
 * active preset and reported success, `toil:set_audio` reported success with
 * no handler behind it at all, and `toil:load_preset` reported success for
 * ids that never loaded.
 */
import type { RefObject } from 'react';
import {
  VIRTUAL_CLAUDE_DEVICE_ID,
  webMidiService,
} from '../core/services/webmidi-controller.ts';
import { resolvePresetId } from '../milkdrop/preset-id-resolution.ts';
import {
  type AgentAudioSource,
  type AgentBridgeCallbacks,
  type AgentCommandResult,
  toAgentEditorState,
} from './agent-bridge.ts';
import {
  getLastCommittedCore,
  getStatusLog,
  suggestIds,
  waitForCommittedCore,
} from './agent-state.ts';
import type { EngineSnapshot } from './engine/engine-snapshot.ts';
import type { EngineContextValue } from './engine-context.tsx';

/**
 * The start path awaits the engine mount itself, so this only covers React
 * committing the new source afterwards. A failed start never commits it, so
 * this is also how long a refusal takes to come back.
 */
const AUDIO_COMMIT_TIMEOUT_MS = 2000;

/**
 * Live switches measured 110–240 ms. The rest is headroom for an engine that
 * mounts on the request and a first shader compile on a slow device; the
 * shell gives up on a preset after 10 s and says so first.
 */
const PRESET_TIMEOUT_MS = 15000;

type EditorSession = Awaited<
  ReturnType<EngineContextValue['applyEditorSourceAwaited']>
>;

/** The start paths report failures (permission denied, a preset that would
 * not load) as a status message rather than a throw. */
function latestStatusSince(startedAt: number): string | undefined {
  return getStatusLog()
    .filter((entry) => entry.at >= startedAt)
    .at(-1)?.message;
}

/** Source handed to the editor either compiled, failed to compile (the last
 * good compile stays on screen), or was never applied because nothing is
 * mounted. */
function describeAppliedSource(
  session: EditorSession,
  subject: string,
): AgentCommandResult {
  if (!session) {
    return {
      success: false,
      reason: 'The visualizer is not running yet, so nothing was applied.',
    };
  }
  const state = toAgentEditorState(session);
  if (state.errorCount > 0) {
    return {
      success: false,
      reason: `${subject} failed to compile, so the previous preset is still on screen.`,
      state,
    };
  }
  return { success: true, state };
}

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
  return {
    success: false,
    reason:
      latestStatusSince(startedAt) ??
      `The ${source} audio source did not start.`,
  };
}

async function loadPresetForAgent(
  engineRef: RefObject<EngineContextValue>,
  engineSnapshotRef: RefObject<EngineSnapshot | null>,
  payload: { presetId?: string; milkSource?: string },
  timeoutMs: number,
): Promise<AgentCommandResult> {
  const startedAt = Date.now();
  if (payload.milkSource) {
    // The editor needs a mounted stage. Before audio, an embedded page mounts
    // nothing until something asks for a catalog preset or audio.
    if (!getLastCommittedCore()?.presetId) {
      return {
        success: false,
        reason:
          'Nothing is on stage yet, so the source was not applied. Load a catalog preset or start audio first.',
      };
    }
    return describeAppliedSource(
      await engineRef.current.applyEditorSourceAwaited(payload.milkSource),
      'The preset source',
    );
  }

  const requested = payload.presetId ?? '';
  // The runtime's catalog is the full one; before the engine mounts only the
  // shell's smaller fallback list exists, which cannot rule an id out.
  const lookup = () => {
    const runtime = engineSnapshotRef.current?.catalogEntries ?? [];
    const full = runtime.length > 0;
    const entries: readonly { id: string; title?: string | null }[] = full
      ? runtime
      : engineRef.current.catalog;
    // The same resolver the route uses, so aliases and slugs load.
    return { full, entries, presetId: resolvePresetId(entries, requested) };
  };
  const refuseUnknown = (entries: readonly { id: string }[]) => {
    const suggestions = suggestIds(
      requested,
      entries.map((entry) => entry.id),
      { maxDistance: 4 },
    );
    return {
      success: false,
      reason: `No preset matches "${requested}" in the ${entries.length}-preset catalog.${
        suggestions.length > 0
          ? ` Did you mean ${suggestions.map((id) => `"${id}"`).join(', ')}?`
          : ''
      }`,
      ...(suggestions.length > 0 ? { suggestions } : {}),
    };
  };

  const initial = lookup();
  if (initial.full && !initial.presetId) return refuseUnknown(initial.entries);

  // Selecting is what mounts an embedded page's engine, so it comes first.
  const before = getLastCommittedCore()?.presetId ?? null;
  engineRef.current.handlePresetSelection(initial.presetId ?? requested);
  const settled = await waitForCommittedCore((core) => {
    const now = lookup();
    if (now.full && !now.presetId) return true;
    if (now.presetId && core.presetId === now.presetId) return true;
    // A booting stage's first preset is its own, not a verdict on this
    // request; only a move away from what was showing is.
    return (
      before !== null && core.presetId !== null && core.presetId !== before
    );
  }, timeoutMs);
  const now = lookup();
  if (now.full && !now.presetId) return refuseUnknown(now.entries);
  if (settled && settled.presetId === now.presetId) {
    return { success: true, presetId: now.presetId };
  }
  // The shell says why when a preset times out or will not load, then shows
  // a fallback.
  return {
    success: false,
    reason:
      latestStatusSince(startedAt) ??
      (settled
        ? `The stage settled on "${settled.presetId}" instead of "${requested}".`
        : `"${now.presetId ?? requested}" did not finish loading within ${timeoutMs / 1000}s.`),
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
  return {
    ...how,
    ...describeAppliedSource(
      await engine.applyEditorSourceAwaited(refinement.milkSource),
      'The tweaked preset',
    ),
  };
}

export function buildAgentBridgeCallbacks({
  engineRef,
  engineSnapshotRef,
  audioCommitTimeoutMs = AUDIO_COMMIT_TIMEOUT_MS,
  presetTimeoutMs = PRESET_TIMEOUT_MS,
}: {
  engineRef: RefObject<EngineContextValue>;
  engineSnapshotRef: RefObject<EngineSnapshot | null>;
  audioCommitTimeoutMs?: number;
  presetTimeoutMs?: number;
}): AgentBridgeCallbacks {
  return {
    // milkSource is how an embedder hands over preset *code* rather than a
    // catalog id.
    onLoadPreset: (payload) =>
      loadPresetForAgent(
        engineRef,
        engineSnapshotRef,
        payload,
        presetTimeoutMs,
      ),
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
