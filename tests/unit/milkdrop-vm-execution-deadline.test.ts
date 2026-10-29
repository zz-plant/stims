/**
 * The hard wall-clock ceiling for preset execution.
 *
 * The shared iteration budget (milkdrop-vm-loop-budget.test.ts) bounds how
 * many loop passes one frame may make. It does not bound how long those
 * passes take: a large body, or a long sum of per-vertex calls that each stay
 * under the per-call cap, can still hold the main thread for seconds. These
 * tests pin the second half of the contract — a step that has spent its
 * wall-clock window stops, skips the remaining program calls, and says so.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { __setJitAvailableForTests } from 'milkdrop-toolchain/src/expression-jit.ts';
import { createMilkdropSignalTracker } from '../../src/js/milkdrop/runtime-signals.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';

const tracker = createMilkdropSignalTracker();

function nextSignals(frame: number) {
  return tracker.update({
    time: frame / 60,
    deltaMs: 1000 / 60,
    analyser: null,
    frequencyData: new Uint8Array(64),
    waveformData: new Uint8Array(64),
  });
}

afterEach(() => {
  __setJitAvailableForTests(null);
});

describe('hard execution deadline', () => {
  test('a heavy per-frame loop stops at the deadline instead of the iteration cap', () => {
    const preset = compileMilkdropPresetSource(
      `
[preset00]
title=Heavy per-frame loop
per_frame_1=loop(2000000, megabuf(0) = megabuf(0) + sin(q1 + 0.001););
      `.trim(),
      { id: 'heavy-per-frame-loop' },
    );
    const vm = createMilkdropVM(preset, undefined, {
      frameDeadlineMs: 10,
      initDeadlineMs: 10,
    });

    const started = Date.now();
    vm.step(nextSignals(1));
    const elapsed = Date.now() - started;

    expect(vm.getExecutionBudgetExceeded()).toBe(true);
    // The unbounded form runs all 2,097,152 passes; this only asserts the
    // ceiling fired rather than timing the machine.
    expect(elapsed).toBeLessThan(1000);
  });

  test('an expensive init program is bounded too', () => {
    const preset = compileMilkdropPresetSource(
      `
[preset00]
title=Heavy init
per_frame_init_1=loop(2000000, megabuf(0) = megabuf(0) + sin(q1 + 0.001););
per_frame_1=q1=0.5;
      `.trim(),
      { id: 'heavy-init' },
    );

    const started = Date.now();
    const vm = createMilkdropVM(preset, undefined, {
      frameDeadlineMs: 10,
      initDeadlineMs: 10,
    });
    const elapsed = Date.now() - started;

    expect(vm.getExecutionBudgetExceeded()).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  test('nested loops unwind together when the deadline trips', () => {
    const preset = compileMilkdropPresetSource(
      `
[preset00]
title=Nested heavy loops
per_frame_1=loop(1000, loop(2000000, megabuf(0) = megabuf(0) + 1;););
      `.trim(),
      { id: 'nested-heavy-loops' },
    );
    const vm = createMilkdropVM(preset, undefined, {
      frameDeadlineMs: 10,
      initDeadlineMs: 10,
    });

    const started = Date.now();
    vm.step(nextSignals(1));
    const elapsed = Date.now() - started;

    expect(vm.getExecutionBudgetExceeded()).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  test('the interpreter tier applies the same deadline', () => {
    __setJitAvailableForTests(false);
    const preset = compileMilkdropPresetSource(
      `
[preset00]
title=Heavy interpreted loop
per_frame_1=loop(2000000, megabuf(0) = megabuf(0) + 1;);
      `.trim(),
      { id: 'heavy-interpreted-loop' },
    );
    const vm = createMilkdropVM(preset, undefined, {
      frameDeadlineMs: 10,
      initDeadlineMs: 10,
    });

    const started = Date.now();
    vm.step(nextSignals(1));
    const elapsed = Date.now() - started;

    expect(vm.getExecutionBudgetExceeded()).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  test('a cheap preset completes without tripping the deadline', () => {
    const preset = compileMilkdropPresetSource(
      `
[preset00]
title=Cheap
per_frame_1=q1=0.5;
per_pixel_1=zoom=zoom+0.001*q1;
      `.trim(),
      { id: 'cheap-preset' },
    );
    const vm = createMilkdropVM(preset);

    const frame = vm.step(nextSignals(1));

    expect(vm.getExecutionBudgetExceeded()).toBe(false);
    expect(frame.variables.q1).toBe(0.5);
  });
});
