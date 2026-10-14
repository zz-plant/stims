import { describe, expect, test } from 'bun:test';
import { createMilkdropBackendFailover } from '../../src/js/milkdrop/runtime/backend-fallback.ts';

/**
 * The per-preset WebGPU -> WebGL failover reloads the page so the fresh
 * renderer selection can read the preset back out of session storage. That
 * makes the storage write load-bearing: when it silently no-ops, the reload
 * re-mounts WebGPU, hits the same unsupported descriptor, and reloads again —
 * an unbounded loop with no user escape. `markPresetNeedsWebgl` reporting
 * failure is the only thing that breaks the cycle, because the reload itself
 * discards the in-memory re-entry latch.
 */
function createFailover(persisted: boolean) {
  const reloads: string[] = [];
  const recorded: Array<{ presetId: string; reason: string }> = [];
  const failover = createMilkdropBackendFailover({
    preferences: {
      recordFallback: (args) => void recorded.push(args),
    },
    reload: (presetId) => void reloads.push(presetId),
    persistFallback: () => persisted,
  });
  return { failover, reloads, recorded };
}

describe('createMilkdropBackendFailover', () => {
  test('reloads once the fallback is durably recorded', () => {
    const { failover, reloads, recorded } = createFailover(true);

    expect(
      failover.trigger({
        presetId: 'preset-a',
        reason: 'unsupported descriptor',
        activeBackend: 'webgpu',
      }),
    ).toBe(true);

    expect(reloads).toEqual(['preset-a']);
    expect(recorded).toEqual([
      { presetId: 'preset-a', reason: 'unsupported descriptor' },
    ]);
  });

  test('does NOT reload when the fallback could not be persisted', () => {
    const { failover, reloads, recorded } = createFailover(false);

    // False tells the caller no reload is coming, so it must carry on setting
    // the preset up on WebGPU. Reporting true here made navigation drop the
    // preset and attachment skip its renderer adapter, leaving a black stage.
    expect(
      failover.trigger({
        presetId: 'preset-a',
        reason: 'unsupported descriptor',
        activeBackend: 'webgpu',
      }),
    ).toBe(false);

    expect(reloads).toEqual([]);
    // Still recorded, so telemetry and the settings UI can still explain why
    // this preset looks wrong.
    expect(recorded).toHaveLength(1);
  });

  test('an unpersisted fallback does not stop later presets', () => {
    const { failover, recorded } = createFailover(false);

    failover.trigger({
      presetId: 'preset-a',
      reason: 'first',
      activeBackend: 'webgpu',
    });
    expect(
      failover.trigger({
        presetId: 'preset-b',
        reason: 'second',
        activeBackend: 'webgpu',
      }),
    ).toBe(false);
    expect(recorded.map((entry) => entry.presetId)).toEqual([
      'preset-a',
      'preset-b',
    ]);
  });

  test('ignores presets already running on WebGL', () => {
    const { failover, reloads } = createFailover(true);

    expect(
      failover.trigger({
        presetId: 'preset-a',
        reason: 'unsupported descriptor',
        activeBackend: 'webgl',
      }),
    ).toBe(false);
    expect(reloads).toEqual([]);
  });

  test('reloads at most once per runtime', () => {
    const { failover, reloads } = createFailover(true);

    failover.trigger({
      presetId: 'preset-a',
      reason: 'first',
      activeBackend: 'webgpu',
    });
    // The page is already on its way out, so the second caller stops too.
    expect(
      failover.trigger({
        presetId: 'preset-b',
        reason: 'second',
        activeBackend: 'webgpu',
      }),
    ).toBe(true);
    expect(reloads).toEqual(['preset-a']);
  });
});
