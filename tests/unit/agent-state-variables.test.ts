import { afterEach, describe, expect, test } from 'bun:test';
import {
  type AgentGlobal,
  installAgentStateGlobal,
} from '../../src/js/frontend/agent-state.ts';
import {
  hasVariableListeners,
  publishVariables,
} from '../../src/js/milkdrop/variable-probe.ts';

/**
 * The agent's window onto a preset's equations. Both calls must resolve from
 * the next frame's variables and leave nothing subscribed behind them — the
 * frame loop pays for every listener.
 */
describe('__stims_agent variables', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  const install = (): AgentGlobal => {
    dispose = installAgentStateGlobal({
      getSnapshot: () => ({}) as never,
      getActions: () => [],
      getTelemetry: () => ({ fps: 0, quality: null }) as never,
      selectPreset: () => {},
      resolvePresetId: () => null,
      getPresetIds: () => [],
      setField: () => {},
      setCrossfade: () => {},
      pinParameter: () => false,
      unpinParameter: () => false,
      getStageCanvas: () => null,
    });
    return (window as unknown as { __stims_agent: AgentGlobal }).__stims_agent;
  };

  test('getVariables resolves with the next frame and unsubscribes', async () => {
    const agent = install();
    const pending = agent.getVariables();
    expect(hasVariableListeners()).toBe(true);
    publishVariables({ q1: 0.25, zoom: 1 });
    expect(await pending).toEqual({ q1: 0.25, zoom: 1 });
    expect(hasVariableListeners()).toBe(false);
  });

  test('waitForVariables skips frames until the predicate holds', async () => {
    const agent = install();
    const pending = agent.waitForVariables((v) => v.q1 > 0.5);
    publishVariables({ q1: 0.1 });
    publishVariables({ q1: 0.9 });
    expect(await pending).toEqual({ q1: 0.9 });
    expect(hasVariableListeners()).toBe(false);
  });

  test('the resolved object is detached from the feed', async () => {
    const agent = install();
    const shared = { q1: 1 };
    const pending = agent.getVariables();
    publishVariables(shared);
    shared.q1 = 99;
    expect((await pending)?.q1).toBe(1);
  });

  test('getVariables gives null and waitForVariables rejects on timeout', async () => {
    const agent = install();
    expect(await agent.getVariables(10)).toBeNull();
    await expect(agent.waitForVariables(() => false, 10)).rejects.toThrow(
      /timed out/u,
    );
    expect(hasVariableListeners()).toBe(false);
  });
});
