import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { MilkdropAgentDriverHandle } from '../../src/js/milkdrop/runtime/debug-snapshot.ts';
import { importFresh, replaceProperty } from '../test-helpers.ts';

type StimsGlobals = typeof globalThis & {
  stims?: unknown;
  __milkdropRuntimeDebug?: MilkdropAgentDriverHandle;
  __stimsAppReady?: Promise<void>;
  __stimsStarterCatalogPromise?: Promise<unknown>;
};

function fakeHandle(
  overrides: Partial<MilkdropAgentDriverHandle> = {},
): MilkdropAgentDriverHandle {
  return {
    getRuntime: () => null,
    getAdapter: () => null,
    getState: () => ({
      activePresetId: 'boot-preset',
      backend: 'webgpu',
      status: null,
    }),
    getAdaptiveQuality: () => null,
    getPerformance: () => null,
    selectPreset: async () => {},
    setAutoplay: () => {},
    startupSettled: async () => {},
    ...overrides,
  };
}

let restoreSearch: (() => void) | null = null;

beforeEach(() => {
  delete (globalThis as StimsGlobals).stims;
  delete (globalThis as StimsGlobals).__milkdropRuntimeDebug;
});

afterEach(() => {
  restoreSearch?.();
  restoreSearch = null;
  delete (globalThis as StimsGlobals).stims;
  delete (globalThis as StimsGlobals).__milkdropRuntimeDebug;
});

function setAgentMode(enabled: boolean) {
  restoreSearch = replaceProperty(window, 'location', {
    ...window.location,
    search: enabled ? '?agent=true' : '',
  });
}

describe('installAgentDriver', () => {
  test('installs nothing outside agent mode', async () => {
    setAgentMode(false);
    const { installAgentDriver } = await importFresh<
      typeof import('../../src/js/core/agent-driver.ts')
    >('src/js/core/agent-driver.ts');

    installAgentDriver();

    expect((globalThis as StimsGlobals).stims).toBeUndefined();
  });

  test('installs window.stims.agent in agent mode', async () => {
    setAgentMode(true);
    const { installAgentDriver } = await importFresh<
      typeof import('../../src/js/core/agent-driver.ts')
    >('src/js/core/agent-driver.ts');

    installAgentDriver();

    const agent = (globalThis as StimsGlobals & { stims?: { agent?: unknown } })
      .stims?.agent;
    expect(agent).toBeDefined();
  });
});

describe('stims.agent.ready', () => {
  test('rejects on timeout when the runtime driver handle never registers', async () => {
    setAgentMode(true);
    const { installAgentDriver } = await importFresh<
      typeof import('../../src/js/core/agent-driver.ts')
    >('src/js/core/agent-driver.ts');
    installAgentDriver();

    await expect(
      (
        globalThis as StimsGlobals & {
          stims: {
            agent: { ready: (o: { timeoutMs: number }) => Promise<void> };
          };
        }
      ).stims.agent.ready({ timeoutMs: 300 }),
    ).rejects.toThrow(/timed out/);
  });

  test('resolves once the driver handle registers and startup settles', async () => {
    setAgentMode(true);
    const { installAgentDriver } = await importFresh<
      typeof import('../../src/js/core/agent-driver.ts')
    >('src/js/core/agent-driver.ts');
    installAgentDriver();

    (globalThis as StimsGlobals).__milkdropRuntimeDebug = fakeHandle();

    await (
      globalThis as StimsGlobals & {
        stims: {
          agent: { ready: (o?: { timeoutMs?: number }) => Promise<void> };
        };
      }
    ).stims.agent.ready({ timeoutMs: 2000 });
  });
});

describe('stims.agent.selectPreset', () => {
  test('reports applied:true when the active preset matches the request', async () => {
    setAgentMode(true);
    const { installAgentDriver } = await importFresh<
      typeof import('../../src/js/core/agent-driver.ts')
    >('src/js/core/agent-driver.ts');
    installAgentDriver();

    let active = 'boot-preset';
    (globalThis as StimsGlobals).__milkdropRuntimeDebug = fakeHandle({
      getState: () => ({
        activePresetId: active,
        backend: 'webgpu',
        status: null,
      }),
      selectPreset: async (presetId) => {
        active = presetId;
      },
    });

    const agent = (
      globalThis as StimsGlobals & {
        stims: {
          agent: {
            selectPreset: (
              id: string,
            ) => Promise<{ applied: boolean; activePresetId: string | null }>;
          };
        };
      }
    ).stims.agent;

    const result = await agent.selectPreset('target-preset');
    expect(result.applied).toBe(true);
    expect(result.activePresetId).toBe('target-preset');
  });

  test('reports applied:false without throwing when the id never lands', async () => {
    setAgentMode(true);
    const { installAgentDriver } = await importFresh<
      typeof import('../../src/js/core/agent-driver.ts')
    >('src/js/core/agent-driver.ts');
    installAgentDriver();

    (globalThis as StimsGlobals).__milkdropRuntimeDebug = fakeHandle({
      selectPreset: async () => {
        // Simulates a bad id / superseded request: the controller resolves
        // without changing the active preset.
      },
    });

    const agent = (
      globalThis as StimsGlobals & {
        stims: {
          agent: {
            selectPreset: (
              id: string,
            ) => Promise<{ applied: boolean; activePresetId: string | null }>;
          };
        };
      }
    ).stims.agent;

    const result = await agent.selectPreset('does-not-exist');
    expect(result.applied).toBe(false);
    expect(result.activePresetId).toBe('boot-preset');
  });

  test('waits for startup selection to settle before selecting', async () => {
    setAgentMode(true);
    const { installAgentDriver } = await importFresh<
      typeof import('../../src/js/core/agent-driver.ts')
    >('src/js/core/agent-driver.ts');
    installAgentDriver();

    const order: string[] = [];
    let resolveStartup: () => void = () => {};
    const startupSettled = new Promise<void>((resolve) => {
      resolveStartup = () => {
        order.push('startup-settled');
        resolve();
      };
    });

    (globalThis as StimsGlobals).__milkdropRuntimeDebug = fakeHandle({
      startupSettled: () => startupSettled,
      selectPreset: async (presetId) => {
        order.push(`selected:${presetId}`);
      },
    });

    const agent = (
      globalThis as StimsGlobals & {
        stims: { agent: { selectPreset: (id: string) => Promise<unknown> } };
      }
    ).stims.agent;

    const pending = agent.selectPreset('target-preset');
    // Give the driver a chance to run ahead if it were (incorrectly) not
    // waiting on startupSettled.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([]);

    resolveStartup();
    await pending;

    expect(order).toEqual(['startup-settled', 'selected:target-preset']);
  });
});

describe('stims.agent.waitForPreset', () => {
  test('resolves once the active preset matches, from an externally-driven change', async () => {
    setAgentMode(true);
    const { installAgentDriver } = await importFresh<
      typeof import('../../src/js/core/agent-driver.ts')
    >('src/js/core/agent-driver.ts');
    installAgentDriver();

    let active = 'boot-preset';
    (globalThis as StimsGlobals).__milkdropRuntimeDebug = fakeHandle({
      getState: () => ({
        activePresetId: active,
        backend: 'webgpu',
        status: null,
      }),
    });

    const agent = (
      globalThis as StimsGlobals & {
        stims: {
          agent: {
            waitForPreset: (
              id: string,
              o?: { timeoutMs?: number },
            ) => Promise<void>;
          };
        };
      }
    ).stims.agent;

    const pending = agent.waitForPreset('target-preset', { timeoutMs: 2000 });
    // Simulates a route/popstate change landing outside selectPreset.
    setTimeout(() => {
      active = 'target-preset';
    }, 20);

    await pending;
  });

  test('rejects with the last-seen preset id on timeout', async () => {
    setAgentMode(true);
    const { installAgentDriver } = await importFresh<
      typeof import('../../src/js/core/agent-driver.ts')
    >('src/js/core/agent-driver.ts');
    installAgentDriver();

    (globalThis as StimsGlobals).__milkdropRuntimeDebug = fakeHandle();

    const agent = (
      globalThis as StimsGlobals & {
        stims: {
          agent: {
            waitForPreset: (
              id: string,
              o?: { timeoutMs?: number },
            ) => Promise<void>;
          };
        };
      }
    ).stims.agent;

    await expect(
      agent.waitForPreset('never-arrives', { timeoutMs: 200 }),
    ).rejects.toThrow(/timed out.*boot-preset/);
  });
});

describe('stims.agent.state', () => {
  test('returns the null snapshot before a driver handle registers', async () => {
    setAgentMode(true);
    const { installAgentDriver } = await importFresh<
      typeof import('../../src/js/core/agent-driver.ts')
    >('src/js/core/agent-driver.ts');
    installAgentDriver();

    const state = (
      globalThis as StimsGlobals & {
        stims: { agent: { state: () => unknown } };
      }
    ).stims.agent.state();

    expect(state).toEqual({
      presetId: null,
      backend: null,
      status: null,
      frameMs: null,
      fps: null,
      qualityStep: null,
      qualityStepCount: null,
      thermalState: null,
      sampleCount: null,
    });
  });

  test('derives fps from the performance tracker, not a cached telemetry EMA', async () => {
    setAgentMode(true);
    const { installAgentDriver } = await importFresh<
      typeof import('../../src/js/core/agent-driver.ts')
    >('src/js/core/agent-driver.ts');
    installAgentDriver();

    (globalThis as StimsGlobals).__milkdropRuntimeDebug = fakeHandle({
      getPerformance: () => ({
        sampleCount: 120,
        windowSize: 120,
        averageFrameMs: 8,
        averageSimulationMs: 4,
        averageRenderMs: 4,
        p95FrameMs: 10,
        maxFrameMs: 12,
        gpuTimings: null,
      }),
      getAdaptiveQuality: () =>
        ({
          qualityStep: 1,
          qualityStepCount: 6,
          thermalState: 'nominal',
        }) as never,
    });

    const state = (
      globalThis as StimsGlobals & {
        stims: { agent: { state: () => { fps: number | null } } };
      }
    ).stims.agent.state();

    expect(state.fps).toBeCloseTo(125, 0);
  });
});

describe('stims.agent.setAutoplay', () => {
  test('delegates to the runtime driver handle', async () => {
    setAgentMode(true);
    const { installAgentDriver } = await importFresh<
      typeof import('../../src/js/core/agent-driver.ts')
    >('src/js/core/agent-driver.ts');
    installAgentDriver();

    const received: { value: boolean | null } = { value: null };
    (globalThis as StimsGlobals).__milkdropRuntimeDebug = fakeHandle({
      setAutoplay: (enabled) => {
        received.value = enabled;
      },
    });

    (
      globalThis as StimsGlobals & {
        stims: { agent: { setAutoplay: (enabled: boolean) => void } };
      }
    ).stims.agent.setAutoplay(true);

    expect(received.value).toBe(true);
  });

  test('is a no-op before a driver handle registers', async () => {
    setAgentMode(true);
    const { installAgentDriver } = await importFresh<
      typeof import('../../src/js/core/agent-driver.ts')
    >('src/js/core/agent-driver.ts');
    installAgentDriver();

    expect(() =>
      (
        globalThis as StimsGlobals & {
          stims: { agent: { setAutoplay: (enabled: boolean) => void } };
        }
      ).stims.agent.setAutoplay(true),
    ).not.toThrow();
  });
});
