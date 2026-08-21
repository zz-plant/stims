/**
 * Bounded teardown for Playwright browsers and contexts.
 *
 * Two suites had their own `closeQuietly`, each awaiting `close()` under a
 * bare try/catch. A `catch` does nothing for a close that never *settles*, and
 * a wedged browser is exactly what a suite has on its hands when teardown runs
 * after a failure — so the `finally` block hung, the error that triggered it
 * never propagated, and the suite died on its outer test timeout with no
 * message. That is how `home-to-live flip` reported a bare 240s timeout while
 * its real failure was a 30s selector timeout it had already hit.
 *
 * Teardown is never a gate: a close that does not finish in time is abandoned
 * and the process reaps the child, which costs nothing next to losing the
 * failure that mattered.
 */
const CLOSE_TIMEOUT_MS = 15_000;

export async function closeQuietly(
  ...closeables: Array<{ close: () => Promise<unknown> }>
): Promise<void> {
  for (const closeable of closeables) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        closeable.close().catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Teardown is best-effort by definition.
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
