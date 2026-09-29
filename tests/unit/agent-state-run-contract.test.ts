import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isHiddenTabSuspendingFrames } from '../../src/js/core/hidden-tab-policy.ts';
import {
  type AgentCoreSnapshot,
  type AgentStateProviders,
  describeAgentState,
  installAgentStateGlobal,
  resetAgentStateForTests,
  suggestIds,
} from '../../src/js/frontend/agent-state.ts';

const CORE: AgentCoreSnapshot = {
  engineState: 'live',
  engineReady: true,
  liveMode: true,
  backend: 'webgl',
  panel: null,
  presetId: 'preset-a',
  presetTitle: 'Preset A',
  catalogSize: 3,
  audioSource: null,
  playbackPaused: false,
  audioEnergy: null,
  autoplay: null,
  transition: { mode: null, blendDuration: null },
  shaderExecution: 'direct',
};

const CATALOG = [
  'martin-skywards',
  'geiss-cauldron',
  'rovastar-parallel-universe',
];

function makeProviders(overrides: Partial<AgentCoreSnapshot> = {}) {
  const calls = {
    selectPreset: [] as string[],
    setField: [] as Array<[string, number]>,
  };
  const providers: AgentStateProviders = {
    getSnapshot: () => ({ ...CORE, ...overrides }),
    getActions: () =>
      [
        { id: 'next-preset', label: 'Next preset (random)', run: () => {} },
        { id: 'previous-preset', label: 'Previous preset', run: () => {} },
        { id: 'audio-demo', label: 'Demo audio', run: () => {} },
      ] as never,
    getTelemetry: () => ({ fps: 60, quality: null }) as never,
    selectPreset: (id) => calls.selectPreset.push(id),
    resolvePresetId: (candidate) =>
      candidate === 'legacy-alias'
        ? 'martin-skywards'
        : CATALOG.includes(candidate)
          ? candidate
          : null,
    getPresetIds: () => CATALOG,
    setField: (key, value) => calls.setField.push([key, value]),
    setCrossfade: () => {},
    pinParameter: () => true,
    unpinParameter: () => true,
    getStageCanvas: () => null,
  };
  return { providers, calls };
}

let cleanup: (() => void) | null = null;
beforeEach(() => resetAgentStateForTests());
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function install(overrides: Partial<AgentCoreSnapshot> = {}) {
  const { providers, calls } = makeProviders(overrides);
  cleanup = installAgentStateGlobal(providers);
  const agent = window.__stims_agent;
  if (!agent)
    throw new Error('installAgentStateGlobal did not install the global');
  return { agent, calls };
}

describe('run(): honest results for the targeted verbs', () => {
  test('select-preset with an id nowhere in the catalog fails and changes nothing', async () => {
    const { agent, calls } = install();
    const result = await agent.run('select-preset', { id: 'martin-skywardz' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no preset matches "martin-skywardz"');
    expect(result.suggestions).toEqual(['martin-skywards']);
    expect(calls.selectPreset).toEqual([]);
  });

  test('select-preset before the catalog loads says how to wait, and does nothing', async () => {
    const { agent, calls } = install({ catalogSize: 0 });
    const result = await agent.run('select-preset', { id: 'martin-skywards' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('catalogSize');
    expect(result.error).toContain('waitFor');
    expect(calls.selectPreset).toEqual([]);
  });

  test('select-preset passes the RESOLVED id, so aliases behave as they do in the route', async () => {
    const { agent, calls } = install();
    const result = await agent.run('select-preset', { id: 'legacy-alias' });
    expect(result.ok).toBe(true);
    expect(calls.selectPreset).toEqual(['martin-skywards']);
  });

  test('set-field rejects a non-finite value instead of writing NaN into the VM', async () => {
    const { agent, calls } = install();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await agent.run('set-field', { key: 'zoom', value });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('finite');
    }
    expect(calls.setField).toEqual([]);
  });

  test('set-field before the engine mounts fails instead of being silently dropped', async () => {
    const { agent, calls } = install({ engineReady: false });
    const result = await agent.run('set-field', { key: 'zoom', value: 1.02 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('engineReady');
    expect(calls.setField).toEqual([]);
  });

  test('set-field writes a valid value, and does not judge the key', async () => {
    const { agent, calls } = install();
    const result = await agent.run('set-field', { key: 'q7', value: 0.5 });
    expect(result.ok).toBe(true);
    expect(calls.setField).toEqual([['q7', 0.5]]);
  });
});

describe('unknown actions', () => {
  test('a typo points at the real id', async () => {
    const { agent } = install();
    const result = await agent.run('nxt-preset');
    expect(result.ok).toBe(false);
    expect(result.suggestions).toContain('next-preset');
    expect(result.error).toContain('Did you mean "next-preset"');
  });

  test('a targeted-verb typo suggests the verb', async () => {
    const { agent } = install();
    const result = await agent.run('select-presets');
    expect(result.suggestions).toContain('select-preset');
  });

  test('nothing close means no suggestions, not a wrong guess', async () => {
    const { agent } = install();
    const result = await agent.run('zzzzzzzz');
    expect(result.ok).toBe(false);
    expect(result.suggestions).toBeUndefined();
    expect(result.error).not.toContain('Did you mean');
  });
});

describe('listActions()', () => {
  test('palette actions keep id and label only; the verbs carry their params', () => {
    const { agent } = install();
    const list = agent.listActions();
    const palette = list.find((a) => a.id === 'next-preset');
    expect(palette).toEqual({
      id: 'next-preset',
      label: 'Next preset (random)',
    });

    const ids = list.map((a) => a.id);
    for (const verb of [
      'select-preset',
      'set-field',
      'crossfade',
      'pin-parameter',
      'unpin-parameter',
    ]) {
      expect(ids).toContain(verb);
    }
    expect(list.find((a) => a.id === 'select-preset')?.params).toHaveProperty(
      'id',
    );
    expect(list.find((a) => a.id === 'set-field')?.params).toHaveProperty(
      'key',
    );
    expect(list.find((a) => a.id === 'set-field')?.params).toHaveProperty(
      'value',
    );
  });
});

describe('waitFor() timeout', () => {
  test('carries the last state and the predicate, so no second getState() is needed', async () => {
    const { agent } = install();
    let message = '';
    try {
      await agent.waitFor((s) => s.presetId === 'never-this-one', 30);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toStartWith('waitFor timed out after 30ms');
    expect(message).toContain('presetId="preset-a"');
    expect(message).toContain('catalogSize=3');
    expect(message).toContain('renderingSuspended=false');
    expect(message).toContain('never-this-one');
  });
});

describe('getState(): hidden-tab visibility', () => {
  const hidden = (value: boolean) =>
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => value,
    });
  // Chrome reports null when no picture-in-picture window is open; the test DOM
  // leaves the property undefined, and the frame loop's rule compares to null.
  const pictureInPicture = (value: unknown) =>
    Object.defineProperty(document, 'pictureInPictureElement', {
      configurable: true,
      get: () => value,
    });
  beforeEach(() => pictureInPicture(null));
  afterEach(() => {
    Reflect.deleteProperty(document, 'hidden');
    Reflect.deleteProperty(document, 'pictureInPictureElement');
    delete document.documentElement.dataset.agentMode;
  });

  test('a hidden tab without agent mode reports rendering suspended', () => {
    const { agent } = install();
    hidden(true);
    const state = agent.getState();
    expect(state.documentHidden).toBe(true);
    expect(state.agentMode).toBe(false);
    expect(state.renderingSuspended).toBe(true);
  });

  test('agent mode keeps a hidden tab rendering, and says so', () => {
    const { agent } = install();
    hidden(true);
    document.documentElement.dataset.agentMode = 'true';
    const state = agent.getState();
    expect(state.agentMode).toBe(true);
    expect(state.renderingSuspended).toBe(false);
  });

  test('an open picture-in-picture window keeps a hidden tab rendering', () => {
    const { agent } = install();
    hidden(true);
    pictureInPicture({});
    expect(agent.getState().renderingSuspended).toBe(false);
  });

  test('a visible tab is never suspended', () => {
    const { agent } = install();
    hidden(false);
    expect(agent.getState().renderingSuspended).toBe(false);
  });

  test('getState() and the frame loop share one rule', () => {
    const { agent } = install();
    for (const [isHidden, agentMode] of [
      [true, false],
      [true, true],
      [false, false],
    ] as const) {
      hidden(isHidden);
      if (agentMode) document.documentElement.dataset.agentMode = 'true';
      else delete document.documentElement.dataset.agentMode;
      expect(agent.getState().renderingSuspended).toBe(
        isHiddenTabSuspendingFrames(),
      );
    }
  });
});

describe('suggestIds', () => {
  const ids = [
    'next-preset',
    'previous-preset',
    'toggle-autoplay',
    'audio-demo',
  ];

  test('finds a one-letter typo and a partial', () => {
    expect(suggestIds('nxt-preset', ids)[0]).toBe('next-preset');
    expect(suggestIds('autoplay', ids)).toContain('toggle-autoplay');
  });

  test('is case-insensitive and ignores blanks', () => {
    expect(suggestIds('NEXT-PRESET', ids)[0]).toBe('next-preset');
    expect(suggestIds('   ', ids)).toEqual([]);
  });

  test('respects the limit and an explicit maxDistance', () => {
    expect(suggestIds('preset', ids, { limit: 1 })).toHaveLength(1);
    expect(suggestIds('qqqq', ids, { maxDistance: 1 })).toEqual([]);
  });
});

describe('describeAgentState', () => {
  test('is one line with the fields an agent needs to see why a wait failed', () => {
    const line = describeAgentState({
      ...CORE,
      fps: null,
      quality: null as never,
      lastError: 'boom',
      statusLog: [],
      documentHidden: true,
      agentMode: false,
      renderingSuspended: true,
    });
    expect(line).not.toContain('\n');
    expect(line).toContain('lastError="boom"');
    expect(line).toContain('renderingSuspended=true');
    expect(line).toContain('fps=null');
  });
});
