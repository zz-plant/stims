import { afterEach, describe, expect, test } from 'bun:test';
import {
  type AgentCoreSnapshot,
  type AgentGlobal,
  emitAgentCommit,
  installAgentStateGlobal,
  resetAgentStateForTests,
} from '../../src/js/frontend/agent-state.ts';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import {
  registerWebMcpTools,
  type WebMcpModelContext,
  type WebMcpProviders,
  type WebMcpTool,
} from '../../src/js/frontend/webmcp-tools.ts';

const CATALOG: PresetCatalogEntry[] = [
  {
    id: 'geiss-cauldron',
    title: 'Cauldron',
    author: 'Geiss',
    tags: ['fire'],
  },
  {
    id: 'martin-neon-tunnel',
    title: 'Neon Tunnel',
    author: 'Martin',
    tags: ['tunnel'],
  },
  { id: 'rovastar-drift', title: 'Drift', author: 'Rovastar' },
];

const CORE: AgentCoreSnapshot = {
  engineState: 'live',
  engineReady: true,
  liveMode: true,
  backend: 'webgpu',
  panel: null,
  presetId: 'geiss-cauldron',
  presetTitle: 'Cauldron',
  presetAuthor: 'Geiss',
  catalogSize: CATALOG.length,
  audioSource: 'demo',
  playbackPaused: false,
  audioEnergy: null,
  autoplay: null,
  transition: { mode: null, blendDuration: null },
  shaderExecution: 'direct',
  appliedShaderExecution: 'direct',
};

/** A model context that records what the page registered and lets the test
 * call a tool the way an agent would. */
function fakeModelContext({ withUnregister = false } = {}) {
  const tools = new Map<string, WebMcpTool>();
  const context: WebMcpModelContext = {
    registerTool: (tool, options) => {
      if (tools.has(tool.name)) throw new Error('duplicate');
      tools.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => tools.delete(tool.name));
    },
    ...(withUnregister
      ? { unregisterTool: (name: string) => void tools.delete(name) }
      : {}),
  };
  const call = (name: string, input: Record<string, unknown> = {}) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`${name} is not registered`);
    return tool.execute(input) as Promise<Record<string, unknown>>;
  };
  return { context, tools, call };
}

function providers(
  agent: AgentGlobal | undefined,
  catalog: readonly PresetCatalogEntry[] = CATALOG,
): WebMcpProviders {
  return {
    getAgent: () => agent,
    getCatalog: () => catalog,
    presetUrl: (id) => `https://toil.fyi/?preset=${id}`,
  };
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  resetAgentStateForTests();
});

/**
 * The real agent global, so play/skip go through its validation. The stage
 * lands the new preset a tick after the shell's commit, the order the
 * runtime uses, so a tool that reads the stage straight away sees the old one.
 */
function installAgent(
  selected: string[],
  ran: string[],
  overrides: Partial<AgentCoreSnapshot> = {},
) {
  const stage: AgentCoreSnapshot = { ...CORE, ...overrides };
  const land = (presetId: string) =>
    setTimeout(() => {
      stage.presetId = presetId;
      emitAgentCommit({ ...stage });
    }, 20);
  cleanup = installAgentStateGlobal({
    getSnapshot: () => ({ ...stage }),
    getActions: () =>
      [
        {
          id: 'next-preset',
          label: 'Play a random preset',
          run: () => {
            ran.push('next');
            land('martin-neon-tunnel');
          },
        },
        {
          id: 'previous-preset',
          label: 'Back to the last preset',
          run: () => {
            ran.push('previous');
            land('geiss-cauldron');
          },
        },
      ] as never,
    getTelemetry: () => ({ fps: 60, quality: null }) as never,
    selectPreset: (id) => {
      selected.push(id);
      if (stage.engineState === 'live') land(id);
    },
    resolvePresetId: (candidate) =>
      CATALOG.some((entry) => entry.id === candidate) ? candidate : null,
    getPresetIds: () => CATALOG.map((entry) => entry.id),
    setField: () => {},
    getEditorSource: () => null,
    applyEditorSource: async () => null,
    setCrossfade: () => {},
    pinParameter: () => true,
    unpinParameter: () => true,
    getStageCanvas: () => null,
  });
  const agent = window.__stims_agent;
  if (!agent) throw new Error('agent global not installed');
  return agent;
}

describe('WebMCP tools', () => {
  test('registers the four tools with schemas, and none without the API', () => {
    const { context, tools } = fakeModelContext();
    const names = registerWebMcpTools(
      providers(undefined),
      new AbortController().signal,
      context,
    );
    expect(names).toEqual([
      'search_presets',
      'play_preset',
      'skip_preset',
      'get_now_playing',
    ]);
    for (const tool of tools.values()) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
    expect(
      registerWebMcpTools(
        providers(undefined),
        new AbortController().signal,
        null,
      ),
    ).toEqual([]);
  });

  test('aborting the signal unregisters every tool, by signal or by name', () => {
    for (const withUnregister of [false, true]) {
      const { context, tools } = fakeModelContext({ withUnregister });
      const controller = new AbortController();
      registerWebMcpTools(providers(undefined), controller.signal, context);
      expect(tools.size).toBe(4);
      controller.abort();
      expect(tools.size).toBe(0);
    }
  });

  test('search_presets ranks matches and returns playable ids with links', async () => {
    const { context, call } = fakeModelContext();
    registerWebMcpTools(
      providers(undefined),
      new AbortController().signal,
      context,
    );
    const result = await call('search_presets', { query: 'neon tunnel' });
    expect(result.ok).toBe(true);
    const results = result.results as Array<{ id: string; url: string }>;
    expect(results[0]?.id).toBe('martin-neon-tunnel');
    expect(results[0]?.url).toBe('https://toil.fyi/?preset=martin-neon-tunnel');
    expect(results.some((r) => r.id === 'rovastar-drift')).toBe(false);

    const limited = await call('search_presets', { query: 'r', limit: 1 });
    expect((limited.results as unknown[]).length).toBe(1);

    expect((await call('search_presets', { query: '  ' })).ok).toBe(false);
  });

  test('search_presets before the catalog loads says to retry', async () => {
    const { context, call } = fakeModelContext();
    registerWebMcpTools(
      providers(undefined, []),
      new AbortController().signal,
      context,
    );
    const result = await call('search_presets', { query: 'geiss' });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain('starting');
  });

  test('play_preset selects a known id and refuses an unknown one with suggestions', async () => {
    const selected: string[] = [];
    const agent = installAgent(selected, []);
    const { context, call } = fakeModelContext();
    registerWebMcpTools(
      providers(agent),
      new AbortController().signal,
      context,
    );

    const miss = await call('play_preset', { id: 'rovastar-drfit' });
    expect(miss.ok).toBe(false);
    expect(miss.suggestions).toEqual(['rovastar-drift']);
    expect(selected).toEqual([]);

    const hit = await call('play_preset', { id: 'rovastar-drift' });
    expect(hit).toMatchObject({
      ok: true,
      nowPlaying: { presetId: 'rovastar-drift' },
    });
    expect(selected).toEqual(['rovastar-drift']);
  });

  test('play_preset before the stage is live says the choice is queued', async () => {
    const selected: string[] = [];
    const agent = installAgent(selected, [], { engineState: 'ready' });
    const { context, call } = fakeModelContext();
    registerWebMcpTools(
      providers(agent),
      new AbortController().signal,
      context,
    );
    const result = await call('play_preset', { id: 'rovastar-drift' });
    expect(result).toMatchObject({ ok: true, queued: true });
    expect(selected).toEqual(['rovastar-drift']);
  });

  test('skip_preset runs next or previous and rejects anything else', async () => {
    const ran: string[] = [];
    const agent = installAgent([], ran);
    const { context, call } = fakeModelContext();
    registerWebMcpTools(
      providers(agent),
      new AbortController().signal,
      context,
    );

    expect((await call('skip_preset', { direction: 'sideways' })).ok).toBe(
      false,
    );
    expect(ran).toEqual([]);
    expect(await call('skip_preset', { direction: 'next' })).toMatchObject({
      ok: true,
      nowPlaying: { presetId: 'martin-neon-tunnel' },
    });
    expect(await call('skip_preset', { direction: 'previous' })).toMatchObject({
      ok: true,
      nowPlaying: { presetId: 'geiss-cauldron' },
    });
    expect(ran).toEqual(['next', 'previous']);
  });

  test('get_now_playing reports the stage, and asks to retry before boot', async () => {
    const agent = installAgent([], []);
    const { context, call } = fakeModelContext();
    registerWebMcpTools(
      providers(agent),
      new AbortController().signal,
      context,
    );
    const playing = await call('get_now_playing');
    expect(playing).toMatchObject({
      ok: true,
      presetId: 'geiss-cauldron',
      title: 'Cauldron',
      stage: 'live',
      backend: 'webgpu',
    });

    const early = fakeModelContext();
    registerWebMcpTools(
      providers(undefined),
      new AbortController().signal,
      early.context,
    );
    expect((await early.call('get_now_playing')).ok).toBe(false);
  });
});
