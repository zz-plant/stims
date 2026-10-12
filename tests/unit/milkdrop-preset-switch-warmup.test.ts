/**
 * Pre-fade pipeline warm-up gate — the scheduling contract of the
 * transition-start spike fix (runtime/preset-switch-warmup.ts).
 *
 * The gate decides when a preset switch may delay its fade behind the
 * incoming preset's WebGPU pipeline warm-up, and bounds that delay. These
 * tests pin the behaviors the fix's safety depends on:
 *
 * - switches that must stay synchronous (WebGL, agent mode, preview, cut
 *   preference, no warm-up seam) do — that is today's switch, unchanged;
 * - the warm-up is invoked before the switch applies, so the fade can only
 *   start after it;
 * - deadline expiry and warm-up failure both fall back to applying the
 *   switch anyway — the gate delays, it never blocks;
 * - both arrivals of one switch share a single warm-up (no duplicate
 *   compiles, no cold-pipeline race between them);
 * - a switch superseded during its warm-up window (rapid double switch)
 *   never applies out of order.
 */
import { describe, expect, test } from 'bun:test';
import {
  createMilkdropPresetPipelineWarmupGate,
  scheduleMilkdropPresetSwitchThroughWarmup,
} from '../../src/js/milkdrop/runtime/preset-switch-warmup.ts';
import { wouldMilkdropSwitchBlendNow } from '../../src/js/milkdrop/runtime/session.ts';
import type {
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropRendererAdapter,
} from '../../src/js/milkdrop/types.ts';

function createCompiled(id: string): MilkdropCompiledPreset {
  return {
    source: { id, title: id, raw: `title=${id}`, origin: 'bundled' },
    title: id,
  } as unknown as MilkdropCompiledPreset;
}

type Event =
  | { kind: 'warmup-start'; presetId: string }
  | { kind: 'apply'; presetId: string };

function createHarness({
  backend = 'webgpu',
  agent = false,
  preview = false,
  wantsBlend = true,
  warmBehavior,
  deadlineMs = 25,
}: {
  backend?: 'webgl' | 'webgpu';
  agent?: boolean;
  preview?: boolean;
  wantsBlend?: boolean;
  /** Controls the adapter's warmupPreset promise. */
  warmBehavior: (
    resolve: () => void,
    reject: (error: unknown) => void,
    presetId: string,
  ) => void;
  deadlineMs?: number;
}) {
  const events: Event[] = [];
  let warmupCalls = 0;
  const adapter = {
    backend,
    warmupPreset: (compiled: MilkdropCompiledPreset) => {
      warmupCalls += 1;
      events.push({ kind: 'warmup-start', presetId: compiled.source.id });
      return new Promise<void>((resolve, reject) =>
        warmBehavior(resolve, reject, compiled.source.id),
      );
    },
  } as unknown as MilkdropRendererAdapter;

  const gate = createMilkdropPresetPipelineWarmupGate({
    getAdapter: () => adapter,
    getBackend: () => backend,
    isAgentMode: () => agent,
    isPreviewMode: () => preview,
    wantsBlendTransition: () => wantsBlend,
    deadlineMs,
  });

  const schedule = ({
    compiled,
    stillCurrent,
  }: {
    compiled: MilkdropCompiledPreset;
    stillCurrent: () => boolean;
  }) =>
    scheduleMilkdropPresetSwitchThroughWarmup({
      compiled,
      gate,
      isSwitchStillCurrent: stillCurrent,
      apply: () => {
        events.push({ kind: 'apply', presetId: compiled.source.id });
      },
    });

  return { events, gate, schedule, warmupCalls: () => warmupCalls };
}

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('preset pipeline warm-up gate', () => {
  test('applies synchronously when no warm-up seam applies', () => {
    for (const overrides of [
      { backend: 'webgl' as const },
      { agent: true },
      { preview: true },
      { wantsBlend: false },
    ]) {
      const harness = createHarness({
        ...overrides,
        warmBehavior: () => {},
      });
      const compiled = createCompiled('preset-a');
      harness.schedule({ compiled, stillCurrent: () => true });
      expect(harness.events).toEqual([{ kind: 'apply', presetId: 'preset-a' }]);
      expect(harness.warmupCalls()).toBe(0);
    }
  });

  test('warms the incoming preset before the switch applies', async () => {
    const harness = createHarness({
      warmBehavior: (resolve) => resolve(),
    });
    const compiled = createCompiled('preset-a');
    harness.schedule({ compiled, stillCurrent: () => true });
    // Not applied synchronously: the apply waits on the warm-up.
    expect(harness.events).toEqual([
      { kind: 'warmup-start', presetId: 'preset-a' },
    ]);
    await settled();
    expect(harness.events).toEqual([
      { kind: 'warmup-start', presetId: 'preset-a' },
      { kind: 'apply', presetId: 'preset-a' },
    ]);
  });

  test('deadline expiry falls back to applying the switch', async () => {
    const harness = createHarness({
      deadlineMs: 10,
      // A wedged compile: never resolves, never rejects.
      warmBehavior: () => {},
    });
    const compiled = createCompiled('preset-a');
    const gateResult = harness.gate(compiled);
    expect(gateResult).not.toBeNull();
    await expect(gateResult).resolves.toBe(false);

    // The switch's later arrival joins the expired warm-up (no re-arm) and
    // still proceeds — the gate delays, it never blocks.
    harness.schedule({ compiled, stillCurrent: () => true });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(harness.events).toEqual([
      { kind: 'warmup-start', presetId: 'preset-a' },
      { kind: 'apply', presetId: 'preset-a' },
    ]);
  });

  test('warm-up failure falls back to applying the switch', async () => {
    const harness = createHarness({
      warmBehavior: (_resolve, reject) =>
        reject(new Error('pipeline compile failed')),
    });
    const compiled = createCompiled('preset-a');
    const gateResult = harness.gate(compiled);
    expect(gateResult).not.toBeNull();
    await expect(gateResult).resolves.toBe(false);

    // The switch's later arrival joins the failed warm-up (no re-arm) and
    // still proceeds.
    harness.schedule({ compiled, stillCurrent: () => true });
    await settled();
    expect(harness.events).toEqual([
      { kind: 'warmup-start', presetId: 'preset-a' },
      { kind: 'apply', presetId: 'preset-a' },
    ]);
  });

  test('one switch warms once, however many arrivals reach the runtime', async () => {
    const harness = createHarness({
      warmBehavior: (resolve) => setTimeout(resolve, 5),
    });
    const compiled = createCompiled('preset-a');
    // The session subscriber and the navigation controller both arrive.
    const first = harness.gate(compiled);
    const second = harness.gate(compiled);
    expect(second).toBe(first);
    await first;
    expect(harness.warmupCalls()).toBe(1);
  });

  test('a superseded switch does not apply after its warm-up resolves', async () => {
    const release: Record<string, () => void> = {};
    const harness = createHarness({
      warmBehavior: (resolve, _reject, presetId) => {
        release[presetId] = resolve;
      },
    });
    const current = { id: 'preset-a' };
    const switchA = createCompiled('preset-a');
    harness.schedule({
      compiled: switchA,
      stillCurrent: () => current.id === 'preset-a',
    });
    // A rapid second switch lands while A's pipelines warm.
    const switchB = createCompiled('preset-b');
    harness.schedule({
      compiled: switchB,
      stillCurrent: () => current.id === 'preset-b',
    });
    current.id = 'preset-b';
    release['preset-b']?.();
    await settled();
    release['preset-a']?.();
    await settled();

    expect(harness.events).toEqual([
      { kind: 'warmup-start', presetId: 'preset-a' },
      { kind: 'warmup-start', presetId: 'preset-b' },
      { kind: 'apply', presetId: 'preset-b' },
    ]);
  });

  test('a later arrival of the same switch joins the settled warm-up', async () => {
    const harness = createHarness({
      warmBehavior: (resolve) => setTimeout(resolve, 5),
    });
    const compiled = createCompiled('preset-a');
    const first = harness.gate(compiled);
    await first;
    // The navigation controller reaches the gate after its own async steps
    // — possibly after the warm-up settled. Joining must be instant and
    // must NOT arm a second warm-up for the same switch.
    const second = harness.gate(compiled);
    expect(second).toBe(first);
    await second;
    expect(harness.warmupCalls()).toBe(1);
  });

  test('a different switch replaces the warm-up slot', async () => {
    const harness = createHarness({
      warmBehavior: (resolve) => setTimeout(resolve, 5),
    });
    await harness.gate(createCompiled('preset-a'));
    // A rapid second switch: the newest selection owns the next transition.
    await harness.gate(createCompiled('preset-b'));
    expect(harness.warmupCalls()).toBe(2);
  });
});

describe('preset pipeline warm-up gate with the runtime blend predicate', () => {
  /**
   * runtime.ts wires `wantsBlendTransition` to `wouldMilkdropSwitchBlendNow`
   * — the same preference AND blend-gate decision beginPresetTransition
   * consults — so a switch the gate is about to turn into a cut never arms
   * the up-to-1.5s warm-up hold. These tests compose the real pieces.
   */
  const heavyFrameState = {
    // MAX_BLEND_WORKLOAD is 6000 segments; a main wave above it refuses.
    mainWave: { positions: new Float32Array(3 * 6001) },
    customWaves: [],
    mesh: { positions: new Float32Array(0) },
    motionVectors: [],
    shapes: [],
    borders: [],
  } as unknown as MilkdropFrameState;
  const lightFrameState = {
    mainWave: { positions: new Float32Array(0) },
    customWaves: [],
    mesh: { positions: new Float32Array(0) },
    motionVectors: [],
    shapes: [],
    borders: [],
  } as unknown as MilkdropFrameState;

  function createSwitchWithRuntimePredicate(
    warmBehavior: (resolve: () => void) => void,
  ) {
    let currentFrameState = lightFrameState;
    const gate = createMilkdropPresetPipelineWarmupGate({
      getAdapter: () =>
        ({
          backend: 'webgpu',
          warmupPreset: () =>
            new Promise<void>((resolve) => warmBehavior(resolve)),
        }) as unknown as MilkdropRendererAdapter,
      getBackend: () => 'webgpu',
      isAgentMode: () => false,
      isPreviewMode: () => false,
      wantsBlendTransition: () =>
        wouldMilkdropSwitchBlendNow({
          currentFrameState,
          pressure: null,
          manual: false,
          transitionMode: 'blend',
          blendDuration: 2.5,
        }),
    });
    return {
      gate,
      refuseBlends: () => {
        currentFrameState = heavyFrameState;
      },
    };
  }

  test('a switch the blend gate will cut applies synchronously, no warm-up', () => {
    const { gate, refuseBlends } = createSwitchWithRuntimePredicate(() => {});
    refuseBlends();
    expect(gate(createCompiled('preset-a'))).toBe(null);
  });

  test('a switch the blend gate will blend arms the warm-up', async () => {
    let released = false;
    const { gate } = createSwitchWithRuntimePredicate((resolve) => {
      if (released) {
        resolve();
        return;
      }
      // Resolve on a later macrotask: the warm-up must still be pending
      // synchronously after the gate call.
      setTimeout(resolve, 0);
    });
    const warmed = gate(createCompiled('preset-a'));
    expect(warmed).not.toBe(null);
    released = true;
    await warmed;
    expect(warmed).resolves.toBe(true);
  });
});
