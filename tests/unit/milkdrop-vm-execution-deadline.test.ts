/**
 * The hard wall-clock ceiling for preset execution.
 *
 * The shared iteration budget (milkdrop-vm-loop-budget.test.ts) bounds how
 * many loop passes one frame may make. It does not bound how long those
 * passes take: a large body, or a long sum of per-vertex calls that each stay
 * under the per-call cap, can still hold the main thread for seconds. These
 * tests pin the second half of the contract — a step that has spent its
 * wall-clock window stops, skips the remaining program calls, and says so.
 *
 * They script `Date.now()` instead of timing the machine, so what they see does
 * not depend on load: the deadline trips exactly where the script says it does.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { __setJitAvailableForTests } from 'milkdrop-toolchain/src/expression-jit.ts';
import {
  __setDefaultExecutionDeadlinesForTests,
  defaultExecutionDeadlines,
} from '../../src/js/milkdrop/execution-deadlines.ts';
import { createMilkdropSignalTracker } from '../../src/js/milkdrop/runtime-signals.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';

const WINDOW_MS = 10;
const EXPLICIT_WINDOW = {
  frameDeadlineMs: WINDOW_MS,
  initDeadlineMs: WINDOW_MS,
};
/**
 * Read before any test changes it, so restoring it cannot hide a preload that
 * stopped lifting the deadlines.
 */
const INSTALLED_BY_PRELOAD = defaultExecutionDeadlines();
const LOOP_PASSES = 2_000_000;

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

let clockSpy: ReturnType<typeof spyOn> | null = null;

/** `Date.now()` returns `elapsedMs(n)` on its nth read since this call. */
function scriptClock(elapsedMs: (read: number) => number) {
  clockSpy?.mockRestore();
  let read = 0;
  clockSpy = spyOn(Date, 'now').mockImplementation(() => {
    read += 1;
    return 1_000_000 + elapsedMs(read);
  });
}

/**
 * The window opens on read 1, the VM's check before the program passes on
 * read 2, and the loop guard's check before its first pass on read 3. Read 4
 * is the guard's next check, partway through the loop, so tripping there
 * proves the loop ran and then stopped, not only that a later call was skipped.
 */
const expireInsideTheLoop = () => scriptClock((read) => (read <= 3 ? 0 : 1000));

const freezeClock = () => scriptClock(() => 0);

/** Passes the loop body made, read back through a frozen clock on the next step. */
function passesRecorded(
  vm: ReturnType<typeof createMilkdropVM>,
  frame: number,
) {
  freezeClock();
  return vm.step(nextSignals(frame)).variables.q1 as number;
}

afterEach(() => {
  clockSpy?.mockRestore();
  clockSpy = null;
  __setJitAvailableForTests(null);
});

describe('hard execution deadline', () => {
  test('a heavy per-frame loop stops at the deadline instead of the iteration cap', () => {
    const preset = compileMilkdropPresetSource(
      `
[preset00]
title=Heavy per-frame loop
per_frame_1=q1=megabuf(0);
per_frame_2=loop(${LOOP_PASSES}, megabuf(0) = megabuf(0) + 1;);
      `.trim(),
      { id: 'heavy-per-frame-loop' },
    );
    freezeClock();
    const vm = createMilkdropVM(preset, undefined, EXPLICIT_WINDOW);

    expireInsideTheLoop();
    vm.step(nextSignals(1));

    expect(vm.getExecutionBudgetExceeded()).toBe(true);
    const passes = passesRecorded(vm, 2);
    expect(passes).toBeGreaterThan(0);
    expect(passes).toBeLessThan(LOOP_PASSES);
  });

  test('without the deadline the same loop runs every pass', () => {
    const preset = compileMilkdropPresetSource(
      `
[preset00]
title=Heavy per-frame loop
per_frame_1=q1=megabuf(0);
per_frame_2=loop(${LOOP_PASSES}, megabuf(0) = megabuf(0) + 1;);
      `.trim(),
      { id: 'heavy-per-frame-loop-unbounded' },
    );
    freezeClock();
    const vm = createMilkdropVM(preset, undefined, EXPLICIT_WINDOW);

    vm.step(nextSignals(1));

    expect(vm.getExecutionBudgetExceeded()).toBe(false);
    expect(passesRecorded(vm, 2)).toBe(LOOP_PASSES);
  });

  test('an expensive init program is bounded too', () => {
    const preset = compileMilkdropPresetSource(
      `
[preset00]
title=Heavy init
per_frame_init_1=loop(${LOOP_PASSES}, megabuf(0) = megabuf(0) + 1;);
per_frame_1=q1=megabuf(0);
      `.trim(),
      { id: 'heavy-init' },
    );

    expireInsideTheLoop();
    const vm = createMilkdropVM(preset, undefined, EXPLICIT_WINDOW);

    expect(vm.getExecutionBudgetExceeded()).toBe(true);
    expect(passesRecorded(vm, 1)).toBeLessThan(LOOP_PASSES);
  });

  test('nested loops unwind together when the deadline trips', () => {
    const preset = compileMilkdropPresetSource(
      `
[preset00]
title=Nested heavy loops
per_frame_1=q1=megabuf(0);
per_frame_2=loop(1000, loop(${LOOP_PASSES}, megabuf(0) = megabuf(0) + 1;););
      `.trim(),
      { id: 'nested-heavy-loops' },
    );
    freezeClock();
    const vm = createMilkdropVM(preset, undefined, EXPLICIT_WINDOW);

    expireInsideTheLoop();
    vm.step(nextSignals(1));

    expect(vm.getExecutionBudgetExceeded()).toBe(true);
    // Had only the inner loop stopped, each of the 1000 outer passes would
    // start it again and spend the frame's whole iteration budget.
    expect(passesRecorded(vm, 2)).toBeLessThan(LOOP_PASSES);
  });

  test('the interpreter tier applies the same deadline', () => {
    __setJitAvailableForTests(false);
    const preset = compileMilkdropPresetSource(
      `
[preset00]
title=Heavy interpreted loop
per_frame_1=q1=megabuf(0);
per_frame_2=loop(${LOOP_PASSES}, megabuf(0) = megabuf(0) + 1;);
      `.trim(),
      { id: 'heavy-interpreted-loop' },
    );
    freezeClock();
    const vm = createMilkdropVM(preset, undefined, EXPLICIT_WINDOW);

    expireInsideTheLoop();
    vm.step(nextSignals(1));

    expect(vm.getExecutionBudgetExceeded()).toBe(true);
    expect(passesRecorded(vm, 2)).toBeLessThan(LOOP_PASSES);
  });

  test('an expired step skips the remaining per-vertex calls', () => {
    const preset = compileMilkdropPresetSource(
      `
[preset00]
title=Per-vertex counter
per_frame_1=q1=megabuf(0);
per_pixel_1=megabuf(0) = megabuf(0) + 1;
      `.trim(),
      { id: 'per-vertex-counter' },
    );
    freezeClock();
    const vm = createMilkdropVM(preset, undefined, EXPLICIT_WINDOW);
    vm.step(nextSignals(1));
    const everyVertex = passesRecorded(vm, 2);
    expect(everyVertex).toBeGreaterThan(1);

    // Read 1 opens the window and read 2 admits per-frame; every later read
    // refuses a vertex.
    scriptClock((read) => (read <= 2 ? 0 : 1000));
    vm.step(nextSignals(3));

    expect(vm.getExecutionBudgetExceeded()).toBe(true);
    // Frames 1 and 2 counted every vertex; frame 3 added none.
    expect(passesRecorded(vm, 4)).toBe(everyVertex * 2);
  });
});

describe('the deadlines a VM gets when its caller names none', () => {
  const cheapPreset = () =>
    compileMilkdropPresetSource(
      `
[preset00]
title=Cheap
per_frame_1=q1=0.5;
per_pixel_1=zoom=zoom+0.001*q1;
      `.trim(),
      { id: 'cheap-preset' },
    );

  describe('in production', () => {
    beforeEach(() => __setDefaultExecutionDeadlinesForTests(null));
    afterEach(() =>
      __setDefaultExecutionDeadlinesForTests(INSTALLED_BY_PRELOAD),
    );

    test('a cheap preset completes inside the window', () => {
      freezeClock();
      const vm = createMilkdropVM(cheapPreset());

      const frame = vm.step(nextSignals(1));

      expect(vm.getExecutionBudgetExceeded()).toBe(false);
      expect(frame.variables.q1).toBe(0.5);
    });

    test('a step has 50 ms', () => {
      freezeClock();
      const vm = createMilkdropVM(cheapPreset());

      scriptClock((read) => (read === 1 ? 0 : 49));
      vm.step(nextSignals(1));
      expect(vm.getExecutionBudgetExceeded()).toBe(false);

      scriptClock((read) => (read === 1 ? 0 : 50));
      vm.step(nextSignals(2));
      expect(vm.getExecutionBudgetExceeded()).toBe(true);
    });

    test('init programs have 500 ms', () => {
      const preset = compileMilkdropPresetSource(
        `
[preset00]
title=Init
per_frame_init_1=q1=1;
        `.trim(),
        { id: 'init-window' },
      );

      scriptClock((read) => (read === 1 ? 0 : 499));
      expect(createMilkdropVM(preset).getExecutionBudgetExceeded()).toBe(false);

      scriptClock((read) => (read === 1 ? 0 : 500));
      expect(createMilkdropVM(preset).getExecutionBudgetExceeded()).toBe(true);
    });
  });

  test('in tests they are lifted, so a loaded machine cannot truncate a frame', () => {
    const vm = createMilkdropVM(cheapPreset());

    // Every read lands long after any finite window has closed.
    let elapsed = 0;
    scriptClock(() => {
      elapsed += 60_000;
      return elapsed;
    });
    const frame = vm.step(nextSignals(1));

    expect(vm.getExecutionBudgetExceeded()).toBe(false);
    expect(frame.variables.q1).toBe(0.5);
  });

  test('a VM that names its own window still gets it in tests', () => {
    const vm = createMilkdropVM(cheapPreset(), undefined, EXPLICIT_WINDOW);

    scriptClock((read) => (read === 1 ? 0 : WINDOW_MS));
    vm.step(nextSignals(1));

    expect(vm.getExecutionBudgetExceeded()).toBe(true);
  });
});
