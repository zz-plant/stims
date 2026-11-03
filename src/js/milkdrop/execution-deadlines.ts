/**
 * The wall-clock ceilings a MilkDrop VM uses when its caller names none.
 *
 * This module has no imports on purpose. The test preload lifts these defaults
 * for every test file, and importing the VM from a preload would pull its whole
 * compiler graph into each one.
 *
 * Why tests lift them: a deadline is a verdict on how busy the machine is, not
 * on the preset. Under load, a step that is otherwise correct gets its
 * per-vertex calls skipped, so a test that asserts on frame contents fails with
 * a partial frame and nothing wrong in the code. A test that is about the
 * deadline passes its own window, or restores these values and scripts the
 * clock (tests/unit/milkdrop-vm-execution-deadline.test.ts).
 */

export type MilkdropExecutionDeadlines = {
  frameDeadlineMs: number;
  initDeadlineMs: number;
};

/**
 * Wall-clock ceiling for one frame's equation execution.
 *
 * The iteration budget bounds a `while(1)` that does almost nothing; it does
 * not bound a loop whose body is expensive, nor the sum of per-vertex calls
 * that each stay under the cap. This is the hard half: once a step has spent
 * this long, its loops stop and every later program call in the frame is
 * skipped, so a hostile or merely pathological preset cannot hold the main
 * thread for seconds. The value is a ceiling, not a target — the heaviest
 * bundled preset measures about 4.5 ms of simulation on reference hardware,
 * and adaptive quality acts long before 50 ms.
 */
const FRAME_EXECUTION_DEADLINE_MS = 50;

/**
 * Wall-clock ceiling for a preset's init programs, which run once per load
 * rather than per frame. Larger than the frame ceiling because a legitimate
 * init may build a table, but still finite: the old code lifted the shared
 * iteration limit for init and relied on the per-call cap alone.
 */
const INIT_EXECUTION_DEADLINE_MS = 500;

const PRODUCTION_DEADLINES: MilkdropExecutionDeadlines = {
  frameDeadlineMs: FRAME_EXECUTION_DEADLINE_MS,
  initDeadlineMs: INIT_EXECUTION_DEADLINE_MS,
};

let defaults = PRODUCTION_DEADLINES;

export function defaultExecutionDeadlines(): MilkdropExecutionDeadlines {
  return defaults;
}

/** Replaces the defaults; `null` restores the production values. */
export function __setDefaultExecutionDeadlinesForTests(
  value: MilkdropExecutionDeadlines | null,
): void {
  defaults = value ?? PRODUCTION_DEADLINES;
}
