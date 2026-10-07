/**
 * Shared dev-server harness for the browser end-to-end tests.
 *
 * Both e2e suites used to spawn vite themselves with `stdio: 'ignore'`, which
 * made a failed start indistinguishable from a slow one: the poll loop simply
 * timed out and every test then failed with ERR_CONNECTION_REFUSED and no
 * explanation. This helper fixes the ways that went wrong:
 *
 *   1. stderr is captured, so a start failure reports why instead of vanishing.
 *   2. `--strictPort` makes vite fail loudly on a busy port. Without it vite
 *      silently moves to the next free port and the tests poll an address
 *      nothing is listening on.
 *   3. The child is spawned detached and killed by process group. `bun run dev`
 *      spawns vite as a grandchild, so signalling only the wrapper orphaned
 *      vite and left it holding the port for the rest of the run.
 *   4. A server is only ready once the child it spawned says it is listening.
 *      `--strictPort` alone was not enough: when another checkout's vite
 *      already held the port (2–3 sessions run e2e suites here at once), the
 *      new vite exited, but the poll loop saw the foreign server answer first
 *      and returned success, so the suite tested the other checkout's code.
 *      The port is now probed before spawning, and the error names the
 *      process that holds it.
 */
import { execFile, spawn } from 'node:child_process';
import { connect } from 'node:net';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

/**
 * Does anything accept TCP connections on 127.0.0.1:`port`?
 *
 * A raw connect rather than an HTTP request: a wedged server still holds the
 * port, and the question here is whether vite can bind it, not whether the
 * holder is healthy.
 */
async function isPortAccepting(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const settle = (accepting: boolean) => {
      socket.destroy();
      resolve(accepting);
    };
    socket.setTimeout(1000, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

async function lsofFields(args: string[]): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('lsof', args, { timeout: 3000 });
    return stdout.split('\n').filter(Boolean);
  } catch {
    // Missing lsof, or no match (lsof exits 1 when it finds nothing).
    return [];
  }
}

/**
 * Names the processes listening on `port`, with their working directories.
 *
 * The working directory is the useful half: every checkout of this repo runs
 * the same `vite`, so only the cwd says which worktree's code is on the port.
 * Best effort; null when lsof is unavailable or finds nothing.
 */
async function describePortOwner(port: number): Promise<string | null> {
  const listeners: { pid: string; command: string }[] = [];
  for (const field of await lsofFields([
    '-nP',
    `-iTCP:${port}`,
    '-sTCP:LISTEN',
    '-Fpc',
  ])) {
    if (field.startsWith('p')) {
      listeners.push({ pid: field.slice(1), command: '' });
    } else if (field.startsWith('c') && listeners.length > 0) {
      listeners[listeners.length - 1].command = field.slice(1);
    }
  }
  if (listeners.length === 0) return null;

  const described = await Promise.all(
    listeners.map(async ({ pid, command }) => {
      const cwd = (
        await lsofFields(['-a', '-p', pid, '-d', 'cwd', '-Fn'])
      ).find((field) => field.startsWith('n'));
      return `pid ${pid} (${command || 'unknown'})${cwd ? ` in ${cwd.slice(1)}` : ''}`;
    }),
  );
  return described.join('; ');
}

async function portOwnerOrHint(port: number): Promise<string> {
  return (
    (await describePortOwner(port)) ??
    `an unidentified process (\`lsof -nP -iTCP:${port} -sTCP:LISTEN\` names it)`
  );
}

/** Waits, bounded, for nothing to accept connections on `port`. */
async function waitForPortRelease(
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (await isPortAccepting(port)) {
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matches ANSI escapes.
const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

export async function startDevServer({
  port,
  startupTimeoutMs = 60000,
  command = [
    'bun',
    'run',
    'vite',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
}: {
  port: number;
  startupTimeoutMs?: number;
  /**
   * The server command. Tests of this harness pass a stand-in; whatever runs
   * must print `http://127.0.0.1:<port>` once it is listening, as vite's
   * `Local:` line does.
   */
  command?: readonly string[];
}): Promise<DevServerHandle> {
  const url = `http://127.0.0.1:${port}`;

  if (await isPortAccepting(port)) {
    throw new Error(
      `Port ${port} is already in use by ${await portOwnerOrHint(port)}.\n` +
        "Refusing to start: this suite's vite would exit on --strictPort and " +
        'the tests would reach that process instead, usually another ' +
        "checkout's vite from a concurrent session. Stop it or wait for its " +
        'suite to finish. If two test files share this port, give one a new ' +
        'TEST_PORT (`bun run check:e2e-ports` lists the ports in use).',
    );
  }

  const [executable, ...args] = command;
  const child = spawn(executable, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });

  // The child's own report that it bound the port. vite prints its URL only
  // after `listen` succeeds, so this is what tells our server apart from a
  // foreign one answering on the same address. CI forces colour on, and vite
  // bolds the port, so escapes are stripped before matching.
  const announcement = new RegExp(`http://127\\.0\\.0\\.1:${port}(?!\\d)`);
  let announced = false;
  let output = '';
  const record = (chunk: Buffer) => {
    // Keep only the tail; vite is chatty and the whole log is never useful.
    output = `${output}${chunk.toString()}`.slice(-4000);
    if (!announced) {
      announced = announcement.test(output.replace(ANSI_ESCAPE, ''));
    }
  };
  child.stdout?.on('data', record);
  child.stderr?.on('data', record);

  let exited: { code: number | null; signal: string | null } | null = null;
  child.once('exit', (code, signal) => {
    exited = { code, signal };
  });

  const signalGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    // Negative pid signals the whole group, so vite dies with the wrapper.
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {}
    }
  };

  const stop = async () => {
    if (!exited) {
      signalGroup('SIGTERM');
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
    // `bun run vite` runs vite as a grandchild, so the wrapper exiting does
    // not mean vite has let go of the port, and a restart that probed it too
    // early would find it "in use" by the server it just stopped.
    const released = !announced || (await waitForPortRelease(port, 5000));
    if (!exited || !released) {
      signalGroup('SIGKILL');
      if (announced) await waitForPortRelease(port, 2000);
    }
  };

  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) {
      const { code, signal } = exited as {
        code: number | null;
        signal: string | null;
      };
      // Most often --strictPort losing a race for the port; say to whom.
      const holder = (await isPortAccepting(port))
        ? ` Port ${port} is now held by ${await portOwnerOrHint(port)}.`
        : '';
      throw new Error(
        `Dev server exited before it started listening (code=${code}, signal=${signal}) on port ${port}.${holder}\n` +
          `--- server output ---\n${output.trim() || '(no output)'}`,
      );
    }
    if (announced && (await isListening(url)) && !exited) {
      return { port, url, stop };
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  await stop();
  if (await isListening(url)) {
    throw new Error(
      `Something answers on ${url}, but the dev server spawned here never reported listening on it, ` +
        `so those responses are not from this checkout. Port ${port} is held by ${await portOwnerOrHint(port)}.\n` +
        `--- server output ---\n${output.trim() || '(no output)'}`,
    );
  }
  throw new Error(
    `Dev server did not listen on ${url} within ${startupTimeoutMs}ms.\n` +
      `--- server output ---\n${output.trim() || '(no output)'}`,
  );
}
