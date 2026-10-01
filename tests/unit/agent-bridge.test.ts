import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getAgentTelemetry,
  initAgentBridge,
  toAgentEditorState,
  updateAgentTelemetry,
} from '../../src/js/frontend/agent-bridge.ts';
import { buildAgentBridgeCallbacks } from '../../src/js/frontend/agent-bridge-handlers.ts';
import {
  type AgentCoreSnapshot,
  emitAgentCommit,
  recordStatusMessage,
  resetAgentStateForTests,
} from '../../src/js/frontend/agent-state.ts';
import {
  createEmptyEngineSnapshot,
  type EngineSnapshot,
} from '../../src/js/frontend/engine/engine-snapshot.ts';
import type { EngineContextValue } from '../../src/js/frontend/engine-context.tsx';
import { mutatePresetStyle } from '../../src/js/milkdrop/preset-mutations.ts';
import type { MilkdropEditorSessionState } from '../../src/js/milkdrop/runtime-types.ts';
import { makeEngineValue, makePresetEntry } from '../frontend-harness.tsx';

describe('agent bridge & telemetry', () => {
  test('updates and reads agent telemetry snapshot', () => {
    updateAgentTelemetry({
      fps: 60,
      backend: 'webgpu',
      audioEnergy: 0.85,
      currentPresetId: 'shifter-snakeskin',
      agentMode: true,
    });

    const telemetry = getAgentTelemetry();
    expect(telemetry.fps).toBe(60);
    expect(telemetry.backend).toBe('webgpu');
    expect(telemetry.audioEnergy).toBe(0.85);
    expect(telemetry.currentPresetId).toBe('shifter-snakeskin');
    expect(telemetry.agentMode).toBe(true);
  });

  test('initializes bridge and responds to postMessage commands', () => {
    let loadedPreset: string | undefined;

    const cleanup = initAgentBridge({
      onLoadPreset: async (payload) => {
        loadedPreset = payload.presetId;
        return { success: true };
      },
    });

    // Create MessageEvent using global/window constructor
    const EventClass =
      (window as unknown as { MessageEvent: typeof MessageEvent })
        .MessageEvent || MessageEvent;
    const event = new EventClass('message', {
      data: {
        type: 'toil:load_preset',
        presetId: 'shifter-snakeskin',
      },
    });

    window.dispatchEvent(event);

    expect(loadedPreset).toBe('shifter-snakeskin');

    cleanup();
  });

  // The live-editing surface exists so an out-of-process agent can tell a
  // landed edit from a rejected one. On screen they look identical: the
  // session keeps rendering the last good compile either way.
  const compiled = (id: string, title: string) => ({
    title,
    source: { id },
  });

  test('projects a clean compile as rendering the edited source', () => {
    const state = toAgentEditorState({
      source: 'title=Clean\nzoom=1.01\n',
      dirty: false,
      diagnostics: [],
      latestCompiled: compiled('clean', 'Clean'),
      activeCompiled: compiled('clean', 'Clean'),
    });

    expect(state.errorCount).toBe(0);
    expect(state.warningCount).toBe(0);
    expect(state.renderingFallback).toBe(false);
    expect(state.presetId).toBe('clean');
    expect(state.sourceLength).toBeGreaterThan(0);
  });

  test('flags that a failed compile left the previous preset on screen', () => {
    const latest = compiled('broken', 'Broken');
    const state = toAgentEditorState({
      source: 'title=Broken\nper_frame_1=wave_r = sin(\n',
      dirty: true,
      diagnostics: [
        {
          severity: 'error',
          code: 'unclosed_paren',
          message: 'Unclosed parenthesis.',
          line: 2,
        },
        {
          severity: 'warning',
          code: 'deprecated',
          message: 'Deprecated field.',
        },
      ],
      latestCompiled: latest,
      // The session substitutes the last good compile when the newest source
      // has errors — this divergence is the whole signal.
      activeCompiled: compiled('previous', 'Previous Preset'),
    });

    expect(state.errorCount).toBe(1);
    expect(state.warningCount).toBe(1);
    expect(state.renderingFallback).toBe(true);
    expect(state.renderedTitle).toBe('Previous Preset');
    expect(state.title).toBe('Broken');
    expect(state.diagnostics[0]?.line).toBe(2);
  });

  test('does not claim a fallback when a compile merely warns', () => {
    const only = compiled('warned', 'Warned');
    const state = toAgentEditorState({
      source: 'title=Warned\n',
      dirty: false,
      diagnostics: [
        { severity: 'warning', code: 'compat', message: 'Partial parity.' },
      ],
      latestCompiled: only,
      activeCompiled: only,
    });

    expect(state.errorCount).toBe(0);
    expect(state.renderingFallback).toBe(false);
  });

  test('exposes the editor surface on the installed bridge', async () => {
    const cleanup = initAgentBridge({
      getEditorState: () =>
        toAgentEditorState({
          source: 'title=Bridged\n',
          dirty: false,
          diagnostics: [],
          latestCompiled: compiled('bridged', 'Bridged'),
          activeCompiled: compiled('bridged', 'Bridged'),
        }),
      getEditorFields: () => ({ zoom: 1.5, warp: 0.25 }),
      applyEditorFields: async (updates) =>
        toAgentEditorState({
          source: `title=Bridged\nzoom=${updates.zoom}\n`,
          dirty: true,
          diagnostics: [],
          latestCompiled: compiled('bridged', 'Bridged'),
          activeCompiled: compiled('bridged', 'Bridged'),
        }),
    });

    const bridge = window.__STIMS_AGENT_BRIDGE__;
    expect(bridge?.getEditorState()?.presetId).toBe('bridged');
    expect(bridge?.getEditorFields()?.zoom).toBe(1.5);
    expect((await bridge?.applyEditorFields({ zoom: 2 }))?.dirty).toBe(true);
    // Unwired callbacks must answer null rather than throw, so a tool calling
    // into a half-mounted page gets a clear "not ready" instead of a crash.
    expect(await bridge?.applyEditorSource('title=x\n')).toBeNull();

    cleanup();
  });
});

/**
 * Every command an embedding page posts gets a `toil:status` reply, and
 * `success: true` only once the effect has landed. `toil:apply_tweak` used to
 * replay the active preset and `toil:set_audio` had no handler at all, and
 * both still answered success.
 */
describe('agent bridge replies report what actually happened', () => {
  type Reply = Record<string, unknown>;
  const parentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');
  const originalFetch = globalThis.fetch;
  let replies: Reply[] = [];
  let onReply: Array<(reply: Reply) => void> = [];
  let cleanup: (() => void) | null = null;

  const PLAYING_SOURCE = [
    '[preset00]',
    'fDecay=0.98',
    'zoom=1.01',
    'warp=0.2',
    'per_frame_1=wave_r = 0.5 + 0.5*sin(time);',
    '',
  ].join('\n');

  const idleCore: AgentCoreSnapshot = {
    engineState: 'ready',
    engineReady: true,
    liveMode: false,
    backend: null,
    panel: null,
    presetId: null,
    presetTitle: null,
    catalogSize: 0,
    audioSource: null,
    playbackPaused: false,
    audioEnergy: null,
    autoplay: null,
    transition: { mode: null, blendDuration: null },
    shaderExecution: null,
  };

  beforeEach(() => {
    replies = [];
    onReply = [];
    resetAgentStateForTests();
    emitAgentCommit(idleCore);
    // The bridge answers its embedding page, so stand one in for it.
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: {
        postMessage: (reply: Reply) => {
          replies.push(reply);
          for (const listener of onReply) listener(reply);
        },
      },
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    if (parentDescriptor) {
      Object.defineProperty(window, 'parent', parentDescriptor);
    }
    globalThis.fetch = originalFetch;
    resetAgentStateForTests();
  });

  const post = (data: Record<string, unknown>) => {
    window.dispatchEvent(new window.MessageEvent('message', { data }));
  };

  const replyTo = (action: string): Promise<Reply> => {
    const existing = replies.find((reply) => reply.action === action);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      onReply.push((reply) => {
        if (reply.action === action) resolve(reply);
      });
    });
  };

  /** The bridge exactly as the app wires it, over a fake engine. Returns
   * the snapshot ref so a test can land the catalog the way the app does. */
  const installAppBridge = (
    engine: Partial<EngineContextValue>,
    options: {
      currentSource?: string;
      catalog?: string[];
      audioCommitTimeoutMs?: number;
      presetTimeoutMs?: number;
    } = {},
  ) => {
    const engineSnapshotRef: { current: EngineSnapshot | null } = {
      current: {
        ...createEmptyEngineSnapshot(),
        currentSource: options.currentSource ?? '',
        catalogEntries: catalogOf(options.catalog ?? []),
      },
    };
    cleanup = initAgentBridge(
      buildAgentBridgeCallbacks({
        engineRef: { current: makeEngineValue(engine) },
        engineSnapshotRef,
        audioCommitTimeoutMs: options.audioCommitTimeoutMs,
        presetTimeoutMs: options.presetTimeoutMs,
      }),
    );
    return engineSnapshotRef;
  };

  const catalogOf = (ids: string[]): EngineSnapshot['catalogEntries'] =>
    ids.map(
      (id) => ({ id, title: id }) as EngineSnapshot['catalogEntries'][number],
    );

  const CATALOG = ['geiss-casino', 'shifter-snakeskin', 'eos-heater-core-c'];

  /** The stage after boot: catalog loaded, preview preset on screen. */
  const stageCore: AgentCoreSnapshot = {
    ...idleCore,
    presetId: 'shifter-snakeskin',
    catalogSize: CATALOG.length,
  };

  const compiledSession = (
    source: string,
    options: { failed?: boolean } = {},
  ): MilkdropEditorSessionState => {
    const latest = { title: 'Tweaked', source: { id: 'tweaked' } };
    return {
      source,
      dirty: false,
      diagnostics: options.failed
        ? [{ severity: 'error', code: 'parse', message: 'Unexpected token.' }]
        : [],
      latestCompiled: latest,
      activeCompiled: options.failed
        ? { title: 'Previous', source: { id: 'previous' } }
        : latest,
    } as unknown as MilkdropEditorSessionState;
  };

  const respondWith = (response: Response) => {
    globalThis.fetch = (async () => response) as unknown as typeof fetch;
  };

  test('set_audio starts the source through the app start path and confirms once the stage plays it', async () => {
    const started: string[] = [];
    installAppBridge({
      handleAudioStart: async (source) => {
        started.push(source);
        // React commits the new source after the start path returns.
        setTimeout(() => {
          emitAgentCommit({
            ...idleCore,
            engineState: 'live',
            liveMode: true,
            audioSource: source,
          });
        }, 0);
        return { ok: true, source };
      },
    });

    post({ type: 'toil:set_audio', source: 'demo' });
    const reply = await replyTo('set_audio');

    expect(started).toEqual(['demo']);
    expect(reply).toMatchObject({
      type: 'toil:status',
      success: true,
      source: 'demo',
    });
  });

  test('set_audio reports why a start failed, straight from the start path', async () => {
    installAppBridge({
      handleAudioStart: async () => ({
        ok: false,
        source: null,
        message: 'Microphone access was denied.',
      }),
    });

    post({ type: 'toil:set_audio', source: 'microphone' });
    const reply = await replyTo('set_audio');

    expect(reply.success).toBe(false);
    expect(reply.reason).toBe('Microphone access was denied.');
  });

  test('set_audio names the fallback an in-app browser started instead', async () => {
    installAppBridge({
      handleAudioStart: async () => ({
        ok: false,
        source: 'demo',
        message:
          'In-app browsers limit live mic access. Started with Demo Audio.',
      }),
    });

    post({ type: 'toil:set_audio', source: 'microphone' });
    const reply = await replyTo('set_audio');

    expect(reply).toMatchObject({ success: false, playing: 'demo' });
  });

  test('set_audio refuses a source an embedding page cannot start, before touching the engine', async () => {
    const started: string[] = [];
    installAppBridge({
      handleAudioStart: async (source) => {
        started.push(source);
        return { ok: true, source };
      },
    });

    post({ type: 'toil:set_audio', source: 'file' });
    const reply = await replyTo('set_audio');

    expect(reply.success).toBe(false);
    expect(String(reply.reason)).toContain('"file"');
    expect(started).toEqual([]);
  });

  test('apply_tweak applies the AI refinement of the playing preset', async () => {
    respondWith(
      new Response(JSON.stringify({ milkSource: '[preset00]\nzoom=1.2\n' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const applied: string[] = [];
    installAppBridge(
      {
        applyEditorSourceAwaited: async (source) => {
          applied.push(source);
          return compiledSession(source);
        },
      },
      { currentSource: PLAYING_SOURCE },
    );

    post({ type: 'toil:apply_tweak', tweak: 'more zoom' });
    const reply = await replyTo('apply_tweak');

    expect(applied).toEqual(['[preset00]\nzoom=1.2\n']);
    expect(reply).toMatchObject({
      success: true,
      method: 'ai',
      tweak: 'more zoom',
    });
  });

  test('apply_tweak falls back to the matching restyle and says so', async () => {
    respondWith(new Response('unavailable', { status: 503 }));
    const applied: string[] = [];
    installAppBridge(
      {
        applyEditorSourceAwaited: async (source) => {
          applied.push(source);
          return compiledSession(source);
        },
      },
      { currentSource: PLAYING_SOURCE },
    );

    post({ type: 'toil:apply_tweak', tweak: 'faster motion' });
    const reply = await replyTo('apply_tweak');

    // The same edit the Refine panel makes for these words offline.
    const restyled = mutatePresetStyle(PLAYING_SOURCE, 'hyperspace');
    expect(restyled).not.toBe(PLAYING_SOURCE);
    expect(applied).toEqual([restyled]);
    expect(reply).toMatchObject({
      success: true,
      method: 'restyle',
      restyle: 'hyperspace',
    });
    expect(String(reply.note)).toContain('503');
  });

  test('apply_tweak refuses a tweak it cannot carry out, leaving the preset alone', async () => {
    respondWith(new Response('unavailable', { status: 503 }));
    const applied: string[] = [];
    installAppBridge(
      {
        applyEditorSourceAwaited: async (source) => {
          applied.push(source);
          return compiledSession(source);
        },
      },
      { currentSource: PLAYING_SOURCE },
    );

    post({ type: 'toil:apply_tweak', tweak: 'more triangles' });
    const reply = await replyTo('apply_tweak');

    expect(reply.success).toBe(false);
    expect(String(reply.reason)).toContain('503');
    expect(applied).toEqual([]);
  });

  test('apply_tweak reports a tweak that failed to compile', async () => {
    respondWith(
      new Response(JSON.stringify({ milkSource: '[preset00]\nzoom=(\n' }), {
        status: 200,
      }),
    );
    installAppBridge(
      {
        applyEditorSourceAwaited: async (source) =>
          compiledSession(source, { failed: true }),
      },
      { currentSource: PLAYING_SOURCE },
    );

    post({ type: 'toil:apply_tweak', tweak: 'more zoom' });
    const reply = await replyTo('apply_tweak');

    expect(reply.success).toBe(false);
    expect(reply.state).toMatchObject({
      errorCount: 1,
      renderingFallback: true,
    });
  });

  test('a command with no handler on the page is refused, not acknowledged', async () => {
    cleanup = initAgentBridge({});

    post({ type: 'toil:set_audio', source: 'demo' });
    post({ type: 'toil:apply_tweak', tweak: 'faster motion' });
    post({ type: 'toil:load_preset', presetId: 'shifter-snakeskin' });
    post({ type: 'toil:apply_source', source: 'zoom=1.5' });

    const outcomes = await Promise.all(
      ['set_audio', 'apply_tweak', 'load_preset', 'apply_source'].map(replyTo),
    );
    for (const outcome of outcomes) {
      expect(outcome.success).toBe(false);
      expect(String(outcome.reason)).toContain('not available');
    }
  });

  test('load_preset resolves the id, switches the stage, and confirms once it shows', async () => {
    emitAgentCommit(stageCore);
    const selected: string[] = [];
    installAppBridge(
      {
        handlePresetSelection: (presetId) => {
          selected.push(presetId);
          setTimeout(() => emitAgentCommit({ ...stageCore, presetId }), 0);
        },
      },
      { catalog: CATALOG },
    );

    // Ids resolve the way the route resolves them, so case does not matter.
    post({ type: 'toil:load_preset', presetId: 'GEISS-CASINO' });
    const reply = await replyTo('load_preset');

    expect(selected).toEqual(['geiss-casino']);
    expect(reply).toMatchObject({ success: true, presetId: 'geiss-casino' });
  });

  test('load_preset before the engine mounts mounts it with that preset', async () => {
    // An embedded page mounts nothing before audio. Only the shell's fallback
    // catalog exists, and selecting the preset is what boots the stage.
    const selected: string[] = [];
    installAppBridge({
      catalog: [makePresetEntry({ id: 'geiss-casino', title: 'Casino' })],
      handlePresetSelection: (presetId) => {
        selected.push(presetId);
        setTimeout(() => emitAgentCommit({ ...stageCore, presetId }), 0);
      },
    });

    post({ type: 'toil:load_preset', presetId: 'geiss-casino' });
    const reply = await replyTo('load_preset');

    expect(selected).toEqual(['geiss-casino']);
    expect(reply).toMatchObject({ success: true, presetId: 'geiss-casino' });
  });

  test('load_preset while the stage boots waits past the boot preset', async () => {
    // Nothing on stage yet: the booting stage shows its own first preset
    // before the requested one lands.
    installAppBridge(
      {
        handlePresetSelection: (presetId) => {
          setTimeout(() => {
            emitAgentCommit({ ...stageCore, presetId: 'first-run' });
            setTimeout(() => emitAgentCommit({ ...stageCore, presetId }), 0);
          }, 0);
        },
      },
      { catalog: CATALOG },
    );

    post({ type: 'toil:load_preset', presetId: 'geiss-casino' });
    const reply = await replyTo('load_preset');

    expect(reply).toMatchObject({ success: true, presetId: 'geiss-casino' });
  });

  test('load_preset reports a stage that settled on a different preset', async () => {
    emitAgentCommit(stageCore);
    installAppBridge(
      {
        // Something else took the stage first, and nothing reported a
        // failure for the requested preset.
        handlePresetSelection: () => {
          setTimeout(
            () => emitAgentCommit({ ...stageCore, presetId: 'autoplay-pick' }),
            0,
          );
        },
      },
      { catalog: CATALOG },
    );

    post({ type: 'toil:load_preset', presetId: 'geiss-casino' });
    const reply = await replyTo('load_preset');

    expect(reply.success).toBe(false);
    expect(String(reply.reason)).toContain('"autoplay-pick"');
  });

  test('load_preset refuses an id the catalog does not have, and suggests the close ones', async () => {
    emitAgentCommit(stageCore);
    const selected: string[] = [];
    installAppBridge(
      { handlePresetSelection: (presetId) => selected.push(presetId) },
      { catalog: CATALOG },
    );

    post({ type: 'toil:load_preset', presetId: 'geiss-casin' });
    const reply = await replyTo('load_preset');

    expect(reply.success).toBe(false);
    expect(reply.suggestions).toEqual(['geiss-casino']);
    expect(selected).toEqual([]);
  });

  test('load_preset reports the shell giving up on a preset', async () => {
    emitAgentCommit(stageCore);
    installAppBridge(
      {
        // What the shell does when a preset will not load: say so, then
        // show the first-run preset instead.
        handlePresetSelection: () => {
          recordStatusMessage(
            '"geiss-casino" could not be loaded. Showing another preset instead.',
          );
          setTimeout(
            () => emitAgentCommit({ ...stageCore, presetId: 'first-run' }),
            0,
          );
        },
      },
      { catalog: CATALOG },
    );

    post({ type: 'toil:load_preset', presetId: 'geiss-casino' });
    const reply = await replyTo('load_preset');

    expect(reply.success).toBe(false);
    expect(reply.reason).toBe(
      '"geiss-casino" could not be loaded. Showing another preset instead.',
    );
  });

  test('load_preset reports a preset that never reaches the stage', async () => {
    emitAgentCommit(stageCore);
    installAppBridge(
      {
        // The selection is taken, but the engine gives up on the preset.
        handlePresetSelection: () => {
          recordStatusMessage('Could not load "geiss-casino".');
        },
      },
      { catalog: CATALOG, presetTimeoutMs: 20 },
    );

    post({ type: 'toil:load_preset', presetId: 'geiss-casino' });
    const reply = await replyTo('load_preset');

    expect(reply.success).toBe(false);
    expect(reply.reason).toBe('Could not load "geiss-casino".');
  });

  test('load_preset with milkSource reports whether the code compiled', async () => {
    emitAgentCommit(stageCore);
    const applied: string[] = [];
    installAppBridge(
      {
        applyEditorSourceAwaited: async (source) => {
          applied.push(source);
          return compiledSession(source, { failed: source.includes('(') });
        },
      },
      { catalog: CATALOG },
    );

    post({ type: 'toil:load_preset', milkSource: '[preset00]\nzoom=1.1\n' });
    const compiled = await replyTo('load_preset');
    replies.length = 0;
    post({ type: 'toil:load_preset', milkSource: '[preset00]\nzoom=(\n' });
    const broken = await replyTo('load_preset');

    expect(applied).toEqual(['[preset00]\nzoom=1.1\n', '[preset00]\nzoom=(\n']);
    expect(compiled.success).toBe(true);
    expect(broken).toMatchObject({
      success: false,
      state: { renderingFallback: true },
    });
  });

  test('load_preset with milkSource is refused while nothing is on stage', async () => {
    const applied: string[] = [];
    installAppBridge({
      applyEditorSourceAwaited: async (source) => {
        applied.push(source);
        return compiledSession(source);
      },
    });

    post({ type: 'toil:load_preset', milkSource: '[preset00]\nzoom=1.1\n' });
    const reply = await replyTo('load_preset');

    expect(reply.success).toBe(false);
    expect(applied).toEqual([]);
  });

  test('load_preset with nothing to load is refused', async () => {
    const loaded: unknown[] = [];
    cleanup = initAgentBridge({
      onLoadPreset: async (payload) => {
        loaded.push(payload);
        return { success: true };
      },
    });

    post({ type: 'toil:load_preset' });
    const reply = await replyTo('load_preset');

    expect(reply.success).toBe(false);
    expect(loaded).toEqual([]);
  });

  test('apply_source before the visualizer is running is not a success', async () => {
    installAppBridge({ applyEditorSourceAwaited: async () => null });

    post({ type: 'toil:apply_source', source: 'zoom=1.5' });
    const reply = await replyTo('apply_source');

    expect(reply).toMatchObject({
      type: 'toil:editor_state',
      success: false,
      state: null,
    });
  });

  test('an unknown toil message is refused, and the bridge never answers its own replies', () => {
    cleanup = initAgentBridge({});

    post({ type: 'toil:status', action: 'set_audio', success: true });
    post({ type: 'toil:telemetry', fps: 60 });
    post({ type: 'toil:spin_faster' });
    post({ type: 'not-ours' });

    expect(replies).toEqual([
      {
        type: 'toil:status',
        action: 'spin_faster',
        success: false,
        reason: 'Unknown message type "toil:spin_faster".',
      },
    ]);
  });
});
