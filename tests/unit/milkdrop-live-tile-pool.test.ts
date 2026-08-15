import { describe, expect, test } from 'bun:test';
import {
  createMilkdropLiveTilePool,
  type MilkdropLiveTileEngine,
} from '../../src/js/milkdrop/live-tile-pool.ts';

type TestHarness = {
  pool: ReturnType<typeof createMilkdropLiveTilePool>;
  runTicks: (count: number) => Promise<void>;
  engines: Map<string, { stepped: number; disposed: boolean }>;
  advance: (ms: number) => void;
};

function createHarness(
  overrides: Partial<
    Parameters<typeof createMilkdropLiveTilePool>[0] & {
      failPresetIds: string[];
    }
  > = {},
): TestHarness {
  let clock = 0;
  const pending: Array<() => void> = [];
  const engines = new Map<string, { stepped: number; disposed: boolean }>();
  const failPresetIds = overrides.failPresetIds ?? [];

  const pool = createMilkdropLiveTilePool({
    loadPresetRaw: (id) => Promise.resolve(`[preset00]\ntitle=${id}\n`),
    maxEngines: overrides.maxEngines ?? 3,
    stepIntervalMs: overrides.stepIntervalMs ?? 50,
    maxStepMsPerTick: overrides.maxStepMsPerTick ?? 1000,
    observeVisibility: false,
    now: () => clock,
    scheduleFrame: (cb) => {
      pending.push(cb);
      return pending.length;
    },
    cancelFrame: () => {},
    createEngine: ({ presetId }): MilkdropLiveTileEngine => {
      if (failPresetIds.includes(presetId)) {
        throw new Error(`boot failure for ${presetId}`);
      }
      const stats = { stepped: 0, disposed: false };
      engines.set(presetId, stats);
      return {
        step: () => {
          stats.stepped += 1;
        },
        dispose: () => {
          stats.disposed = true;
        },
      };
    },
    ...('loadPresetRaw' in overrides
      ? { loadPresetRaw: overrides.loadPresetRaw }
      : {}),
  });

  return {
    pool,
    engines,
    advance: (ms) => {
      clock += ms;
    },
    runTicks: async (count) => {
      for (let i = 0; i < count; i += 1) {
        clock += 60;
        const callbacks = pending.splice(0, pending.length);
        for (const cb of callbacks) {
          cb();
        }
        // Let the async boot promise chain settle between ticks.
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

describe('milkdrop live tile pool', () => {
  test('boots one tile per tick and steps live tiles', async () => {
    const harness = createHarness();
    harness.pool.acquire('a');
    harness.pool.acquire('b');

    await harness.runTicks(1);
    expect(harness.pool.engineCount()).toBe(1);

    await harness.runTicks(1);
    expect(harness.pool.engineCount()).toBe(2);

    await harness.runTicks(3);
    expect(harness.engines.get('a')?.stepped ?? 0).toBeGreaterThan(0);
    expect(harness.engines.get('b')?.stepped ?? 0).toBeGreaterThan(0);
  });

  test('caps live engines and evicts released tiles first', async () => {
    const harness = createHarness({ maxEngines: 2 });
    const first = harness.pool.acquire('a');
    harness.pool.acquire('b');
    await harness.runTicks(2);
    expect(harness.pool.engineCount()).toBe(2);

    // Release "a" and acquire a third preset: "a" should be evicted for it.
    first.release();
    harness.pool.acquire('c');
    await harness.runTicks(2);

    expect(harness.pool.engineCount()).toBe(2);
    expect(harness.engines.get('a')?.disposed).toBe(true);
    expect(harness.engines.get('c')).toBeDefined();
  });

  test('does not evict visible referenced tiles for new arrivals', async () => {
    const harness = createHarness({ maxEngines: 2 });
    harness.pool.acquire('a');
    harness.pool.acquire('b');
    await harness.runTicks(2);

    harness.pool.acquire('c');
    await harness.runTicks(2);

    // No capacity: c waits, a and b keep running.
    expect(harness.pool.engineCount()).toBe(2);
    expect(harness.engines.get('c')).toBeUndefined();
    expect(harness.engines.get('a')?.disposed).toBeFalsy();
    expect(harness.engines.get('b')?.disposed).toBeFalsy();
  });

  test('a failed boot marks the tile failed without breaking the pool', async () => {
    const harness = createHarness({ failPresetIds: ['bad'] });
    const bad = harness.pool.acquire('bad');
    harness.pool.acquire('good');
    await harness.runTicks(3);

    expect(bad.getStatus()).toBe('failed');
    expect(harness.engines.get('good')?.stepped ?? 0).toBeGreaterThan(0);
  });

  test('re-acquiring a preset reuses the same canvas and engine', async () => {
    const harness = createHarness();
    const first = harness.pool.acquire('a');
    await harness.runTicks(2);
    first.release();

    const second = harness.pool.acquire('a');
    expect(second.canvas).toBe(first.canvas);
    await harness.runTicks(1);
    expect(harness.pool.engineCount()).toBe(1);
    expect(harness.engines.get('a')?.disposed).toBeFalsy();
  });

  test('respects the per-tick step interval', async () => {
    const harness = createHarness({ stepIntervalMs: 1000 });
    harness.pool.acquire('a');
    await harness.runTicks(5);
    // Ticks advance 60ms each; with a 1s interval the tile steps once.
    expect(harness.engines.get('a')?.stepped).toBe(1);
  });

  test('dispose tears down every engine', async () => {
    const harness = createHarness();
    harness.pool.acquire('a');
    harness.pool.acquire('b');
    await harness.runTicks(3);
    harness.pool.dispose();
    expect(harness.engines.get('a')?.disposed).toBe(true);
    expect(harness.engines.get('b')?.disposed).toBe(true);
    expect(harness.pool.engineCount()).toBe(0);
  });
});
