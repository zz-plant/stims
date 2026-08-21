/**
 * Deadlines for the browser calls that do not carry one.
 *
 * A browser test that is failing has usually already wedged the page or the
 * browser process, and that is exactly when the teardown and diagnostic calls
 * pointed at it stop answering. Playwright's `evaluate()` takes no timeout at
 * all, and `close()`/`click()` take one only if you pass it, so an unbounded
 * call in that state does not fail — it absorbs whatever is left of the test
 * budget and the runner reports `timed out after 240000ms` naming no step.
 *
 * That is what made #1123 so hard to place. The hang appeared to move between
 * runs and between tests, because whichever unbounded call happened to be
 * reached first swallowed the clock; the visible symptom (which test "hung")
 * was an artifact of ordering, not a clue about the cause. A `try/catch`
 * around such a call is no protection either: a hang is not a throw.
 *
 * So the rule these helpers encode is that every call which can wait on a
 * wedged page gets a deadline, and blowing it produces a message naming what
 * was being attempted.
 */

/** Rejects with a named error if `work` outlives `ms`. */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out after ${ms}ms while ${label}. The page stopped ` +
                  'answering — usually a blocked main thread rather than a ' +
                  'missing element.',
              ),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** How long a single close() gets before we give up and move on. */
const CLOSE_TIMEOUT_MS = 15_000;

/**
 * Closes each resource, tolerating both throws and hangs.
 *
 * This runs in `finally`, so anything it fails to bound is charged to the
 * test that was already failing. Closing a wedged browser can block forever;
 * when it does, the process is left for the runner to reap (`killed 1
 * dangling process` in the log) and the real failure is buried under a budget
 * timeout. Giving up on a close leaks a browser for the rest of the run,
 * which is the cheaper of the two problems by a wide margin.
 */
export async function closeQuietly(
  ...closeables: Array<{ close: () => Promise<unknown> }>
): Promise<void> {
  for (const closeable of closeables) {
    try {
      await withDeadline(
        Promise.resolve(closeable.close()),
        CLOSE_TIMEOUT_MS,
        'closing a browser or context during teardown',
      );
    } catch {
      // Deliberately swallowed: teardown must not replace the real failure.
    }
  }
}
