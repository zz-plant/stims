/**
 * Shared dev-server harness for the browser end-to-end tests.
 *
 * Both e2e suites used to spawn vite themselves with `stdio: 'ignore'`, which
 * made a failed start indistinguishable from a slow one: the poll loop simply
 * timed out and every test then failed with ERR_CONNECTION_REFUSED and no
 * explanation. This helper fixes the three ways that went wrong:
 *
 *   1. stderr is captured, so a start failure reports why instead of vanishing.
 *   2. `--strictPort` makes vite fail loudly on a busy port. Without it vite
 *      silently moves to the next free port and the tests poll an address
 *      nothing is listening on.
 *   3. The child is spawned detached and killed by process group. `bun run dev`
 *      spawns vite as a grandchild, so signalling only the wrapper orphaned
 *      vite and left it holding the port for the rest of the run.
 */
import { spawn } from 'node:child_process';

export type DevServerHandle = {
  readonly port: number;
  readonly url: string;
  stop: () => Promise<void>;
};

/** Any HTTP response proves the server is listening; a 404 counts. */
async function isListening(url: string): Promise<boolean> {
  return isResponsive(url, 2000);
}

/**
 * Bounded health probe: does the server answer within `timeoutMs`?
 *
 * The timeout is the entire point. A suite that re-checks its dev server with
 * a bare `fetch` has no defence against vite being alive-but-wedged — the
 * socket is accepted, no response ever comes, and the probe hangs forever.
 * That is not hypothetical: it is how a 180s e2e budget got consumed with no
 * output at all, because the hang happened in the health check before the
 * test had logged anything or navigated anywhere. An unresponsive server must
 * look like a dead one so the caller can restart it.
 */
export async function isResponsive(
  url: string,
  timeoutMs = 5000,
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Any status proves it is serving; only a transport failure or a timeout
    // means it is gone.
    void response.status;
    return true;
  } catch {
    return false;
  }
}

export async function startDevServer({
  port,
  startupTimeoutMs = 60000,
}: {
  port: number;
  startupTimeoutMs?: number;
}): Promise<DevServerHandle> {
  const url = `http://127.0.0.1:${port}`;

  const child = spawn(
    'bun',
    [
      'run',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BROWSER: 'none' },
    },
  );

  let output = '';
  const record = (chunk: Buffer) => {
    // Keep only the tail; vite is chatty and the whole log is never useful.
    output = `${output}${chunk.toString()}`.slice(-4000);
  };
  child.stdout?.on('data', record);
  child.stderr?.on('data', record);

  let exited: { code: number | null; signal: string | null } | null = null;
  child.once('exit', (code, signal) => {
    exited = { code, signal };
  });

  const stop = async () => {
    if (exited || child.pid === undefined) return;
    // Negative pid signals the whole group, so vite dies with the wrapper.
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (!exited && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }
  };

  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) {
      const { code, signal } = exited as {
        code: number | null;
        signal: string | null;
      };
      throw new Error(
        `Dev server exited before it started listening (code=${code}, signal=${signal}) on port ${port}.\n` +
          `--- server output ---\n${output.trim() || '(no output)'}`,
      );
    }
    if (await isListening(url)) {
      return { port, url, stop };
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  await stop();
  throw new Error(
    `Dev server did not listen on ${url} within ${startupTimeoutMs}ms.\n` +
      `--- server output ---\n${output.trim() || '(no output)'}`,
  );
}
