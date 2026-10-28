/**
 * Dev and production servers for the lab, capture and benchmark scripts, and
 * the vite spawner that the browser e2e harness (`tests/e2e/dev-server.ts`)
 * shares with them.
 *
 * Every checkout of this repo runs the same vite on the same default ports
 * (5197 for lab:visual, 5198 for the replay and profile tools, …), and two or
 * three sessions often work in separate worktrees at once. `ensureDevServer`
 * used to reuse whatever answered on its port, so a lab run could silently
 * measure another worktree's runtime code (observed 2026-08-10, when
 * lab:visual measured a five-day-old server). It now:
 *
 *   1. Reuses a server only when every process listening on the port has this
 *      checkout as its working directory. A request such as
 *      `/@fs/<repoRoot>/package.json` cannot make that distinction when one
 *      checkout sits inside another: `.claude/worktrees/*` is inside the main
 *      checkout, and the main checkout's vite serves files from it.
 *   2. Otherwise fails, naming the holder and its directory.
 *   3. Spawns vite with `--strictPort` and treats it as ready only once that
 *      child prints its own `Local:` line. Without both, vite moved to the next
 *      free port and the readiness poll accepted whatever answered.
 *   4. Resolves `close()` only once the port is free, so a script that starts
 *      one server per preset never finds the previous one still shutting down.
 */
import { execFile, spawn } from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type DevServer = {
  /** Stops a server this call started (no-op for a reused one); resolves once its port is free. */
  close: () => Promise<void>;
};

export type DevServerHandle = {
  readonly port: number;
  readonly url: string;
  stop: () => Promise<void>;
};

export type PerformanceServerMode = 'development' | 'production';

export async function isPortOpen(
  port: number,
  path = '/?agent=true',
): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.status < 500;
  } catch {
    return false;
  }
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
export async function isPortAccepting(port: number): Promise<boolean> {
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

async function commandLines(
  command: string,
  args: string[],
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 3000 });
    return stdout.split('\n').filter(Boolean);
  } catch {
    // Missing tool, or no match (lsof exits 1 when it finds nothing).
    return [];
  }
}

type PortListener = { pid: string; command: string; cwd: string | null };

/**
 * The processes listening on `port`, with their working directories.
 *
 * The working directory is the useful half: every checkout of this repo runs
 * the same `vite`, so only the cwd says which worktree's code is on the port.
 * Best effort; empty when lsof is unavailable or finds nothing, and `cwd` is
 * null when lsof cannot read it.
 */
async function portListeners(port: number): Promise<PortListener[]> {
  const listeners: PortListener[] = [];
  for (const field of await commandLines('lsof', [
    '-nP',
    `-iTCP:${port}`,
    '-sTCP:LISTEN',
    '-Fpc',
  ])) {
    if (field.startsWith('p')) {
      listeners.push({ pid: field.slice(1), command: '', cwd: null });
    } else if (field.startsWith('c') && listeners.length > 0) {
      listeners[listeners.length - 1].command = field.slice(1);
    }
  }
  await Promise.all(
    listeners.map(async (listener) => {
      const cwd = (
        await commandLines('lsof', [
          '-a',
          '-p',
          listener.pid,
          '-d',
          'cwd',
          '-Fn',
        ])
      ).find((field) => field.startsWith('n'));
      listener.cwd = cwd ? cwd.slice(1) : null;
    }),
  );
  return listeners;
}

function describeListeners(port: number, listeners: PortListener[]): string {
  if (listeners.length === 0) {
    return `an unidentified process (\`lsof -nP -iTCP:${port} -sTCP:LISTEN\` names it)`;
  }
  return listeners
    .map(
      ({ pid, command, cwd }) =>
        `pid ${pid} (${command || 'unknown'})${cwd ? ` in ${cwd}` : ''}`,
    )
    .join('; ');
}

/** Names whatever listens on `port`, or says how to find it. */
export async function describePortOwner(port: number): Promise<string> {
  return describeListeners(port, await portListeners(port));
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

/**
 * Spawns a dev server on `port` and resolves once that child reports it is
 * listening. It does not probe the port first: callers decide what a busy
 * port means (the e2e harness refuses it, `ensureDevServer` may reuse it).
 */
export async function spawnDevServer({
  port,
  command,
  cwd = process.cwd(),
  startupTimeoutMs = 60000,
}: {
  port: number;
  /**
   * The server command. It must bind `port` without falling back to another
   * (vite's `--strictPort`) and print `http://127.0.0.1:<port>` once
   * listening, as vite's `Local:` line does. Tests pass a stand-in.
   */
  command: readonly string[];
  cwd?: string;
  startupTimeoutMs?: number;
}): Promise<DevServerHandle> {
  const url = `http://127.0.0.1:${port}`;

  // The child writes to a file, not a pipe. A lab script that exits without
  // closing its server leaves vite running for the next run to reuse, and a
  // child whose stdout pipe has lost its reader dies on its next log line.
  // The file is unlinked once startup settles; the child keeps its own fd.
  const logDir = mkdtempSync(join(tmpdir(), 'stims-dev-server-'));
  const logPath = join(logDir, 'output.log');
  const logFd = openSync(logPath, 'w');
  const [executable, ...args] = command;
  const child = (() => {
    try {
      return spawn(executable, args, {
        cwd,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        // STIMS_LIVE_CHANNEL=0: an automated run must not take over the
        // scratch/live/ files of the dev server a person is watching.
        env: { ...process.env, BROWSER: 'none', STIMS_LIVE_CHANNEL: '0' },
      });
    } finally {
      closeSync(logFd);
    }
  })();

  const state: {
    exited: { code: number | null; signal: string | null } | null;
    announced: boolean;
    spawnError: string;
  } = { exited: null, announced: false, spawnError: '' };
  child.once('exit', (code, signal) => {
    state.exited = { code, signal };
  });
  child.once('error', (error) => {
    state.spawnError = `${error.message}\n`;
    state.exited ??= { code: null, signal: null };
  });

  // Keep only the tail; vite is chatty and the whole log is never useful.
  const output = () => {
    let text = state.spawnError;
    try {
      text += readFileSync(logPath, 'utf8');
    } catch {}
    return text.slice(-4000).trim() || '(no output)';
  };

  // The child's own report that it bound the port. vite prints its URL only
  // after `listen` succeeds, so this is what tells our server apart from a
  // foreign one answering on the same address. CI forces colour on, and vite
  // bolds the port, so escapes are stripped before matching.
  const announcement = new RegExp(`http://127\\.0\\.0\\.1:${port}(?!\\d)`);

  const signalGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    // Negative pid signals the whole group, so vite dies with any wrapper.
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {}
    }
  };

  const exitWithin = (timeoutMs: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });

  const stop = async () => {
    if (!state.exited) {
      signalGroup('SIGTERM');
      await exitWithin(5000);
    }
    // `bun run vite` runs vite as a grandchild, so the wrapper exiting does
    // not mean vite has let go of the port, and a restart that probed it too
    // early would find it "in use" by the server it just stopped.
    const released = !state.announced || (await waitForPortRelease(port, 5000));
    if (!state.exited || !released) {
      signalGroup('SIGKILL');
      if (state.announced) await waitForPortRelease(port, 2000);
    }
  };

  const deadline = Date.now() + startupTimeoutMs;
  try {
    while (Date.now() < deadline) {
      if (state.exited) {
        const { code, signal } = state.exited;
        // Most often --strictPort losing a race for the port; say to whom.
        const holder = (await isPortAccepting(port))
          ? ` Port ${port} is now held by ${await describePortOwner(port)}.`
          : '';
        throw new Error(
          `Dev server exited before it started listening (code=${code}, signal=${signal}) on port ${port}.${holder}\n` +
            `--- server output ---\n${output()}`,
        );
      }
      if (!state.announced) {
        state.announced = announcement.test(output().replace(ANSI_ESCAPE, ''));
      }
      if (state.announced && (await isResponsive(url, 2000)) && !state.exited) {
        return { port, url, stop };
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    await stop();
    if (await isResponsive(url, 2000)) {
      throw new Error(
        `Something answers on ${url}, but the dev server spawned here never reported listening on it, ` +
          `so those responses are not from this checkout. Port ${port} is held by ${await describePortOwner(port)}.\n` +
          `--- server output ---\n${output()}`,
      );
    }
    throw new Error(
      `Dev server did not listen on ${url} within ${startupTimeoutMs}ms.\n` +
        `--- server output ---\n${output()}`,
    );
  } finally {
    rmSync(logDir, { recursive: true, force: true });
  }
}

async function processStartTime(pid: string): Promise<string | null> {
  const [started] = await commandLines('ps', ['-o', 'lstart=', '-p', pid]);
  return started?.trim() || null;
}

/**
 * Returns a dev server serving `repoRoot`: the one already on `port` if this
 * checkout started it, otherwise a new vite. Throws when another process
 * holds the port, rather than measuring that process's code.
 */
export async function ensureDevServer(
  port = 5173,
  repoRoot = process.cwd(),
  {
    command = [
      process.execPath,
      './node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    startupTimeoutMs,
  }: {
    /** Overrides the vite command; tests pass a stand-in. */
    command?: readonly string[];
    startupTimeoutMs?: number;
  } = {},
): Promise<DevServer> {
  if (await isPortAccepting(port)) {
    const root = realpathSync(repoRoot);
    const listeners = await portListeners(port);
    const holder = describeListeners(port, listeners);
    if (
      listeners.length > 0 &&
      listeners.every((listener) => listener.cwd === root)
    ) {
      // Say when it started: a long-running server is the first suspect when
      // a result contradicts an edit you just made.
      const started = await processStartTime(listeners[0].pid);
      console.log(
        `Reusing this checkout's dev server on port ${port}: ${holder}${started ? `, running since ${started}` : ''}`,
      );
      return { close: async () => {} };
    }
    const foreign = listeners.some(
      (listener) => listener.cwd !== null && listener.cwd !== root,
    );
    throw new Error(
      `Port ${port} is already in use by ${holder}, which ${foreign ? 'is not' : 'cannot be confirmed as'} a dev server for this checkout (${root}).\n` +
        "Refusing to reuse it: this run would measure that process's code, not this checkout's. " +
        'Stop it, or give this run a free port (`--port <n>` on scripts that take one).',
    );
  }

  console.log(`Starting Vite dev server on port ${port}...`);
  const server = await spawnDevServer({
    port,
    command,
    cwd: repoRoot,
    startupTimeoutMs,
  });
  console.log(`Dev server started on port ${port}`);
  return { close: server.stop };
}

async function isProductionServer(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/?agent=true`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.headers.get('x-stims-server') === 'production';
  } catch {
    return false;
  }
}

async function runBuild(repoRoot: string) {
  const child = spawn(process.execPath, ['run', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, BROWSER: 'none' },
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (exitCode !== 0) {
    throw new Error(
      `Production build exited with code ${exitCode ?? 'unknown'}.`,
    );
  }
}

export async function ensureProductionServer(
  port = 4173,
  repoRoot = process.cwd(),
): Promise<DevServer> {
  await runBuild(repoRoot);

  if (await isPortOpen(port)) {
    if (await isProductionServer(port)) {
      console.log(`Production server already running on port ${port}`);
      return { close: async () => {} };
    }
    throw new Error(
      `Port ${port} is already serving a non-production app. Choose another port or use --server development.`,
    );
  }

  console.log(`Starting production server on port ${port}...`);
  const child = spawn(process.execPath, ['run', 'scripts/serve-dist.ts'], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, BROWSER: 'none', PORT: String(port) },
  });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        'Production server exited before it could accept requests.',
      );
    }
    if (await isProductionServer(port)) {
      console.log(`Production server started on port ${port}`);
      return {
        close: async () => {
          if (child.pid === undefined) return;
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            child.kill('SIGTERM');
          }
        },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for production server on port ${port}.`);
}

export function ensurePerformanceServer({
  mode,
  port,
  repoRoot,
}: {
  mode: PerformanceServerMode;
  port: number;
  repoRoot: string;
}) {
  return mode === 'production'
    ? ensureProductionServer(port, repoRoot)
    : ensureDevServer(port, repoRoot);
}
