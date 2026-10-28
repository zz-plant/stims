/**
 * Behavioural coverage for dev-server port ownership, through both front ends
 * of `scripts/dev-server.ts`: the e2e harness's `startDevServer` and the lab
 * scripts' `ensureDevServer`.
 *
 * The defect, in both: another checkout's vite already listened on the port
 * and the caller used it. The e2e harness's own vite exited on --strictPort
 * and its readiness poll saw the foreign server answer, so
 * landing-route.test.ts passed or failed depending on what the other
 * session's worktree served. `ensureDevServer` reused any server on its port
 * outright, so lab:visual measured a five-day-old server's runtime code.
 *
 * These run the real code against a stand-in for vite: a few lines of Bun
 * that bind the port and print vite's `Local:` line, or lose the race for the
 * port, or hang, on cue. A foreign server is either a `Bun.serve` in this
 * process, which the code should name as the port's owner, or a stand-in
 * started in another directory, when the test is about whose checkout it is.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDevServer } from '../../scripts/dev-server.ts';
import { type DevServerHandle, startDevServer } from '../e2e/dev-server.ts';

/**
 * The stand-in vite. argv: <port>. Binds like `vite --strictPort`, prints
 * vite's coloured `Local:` line (CI forces colour on), and on SIGTERM keeps
 * the port briefly while it shuts down, as vite does.
 */
const FAKE_VITE_SERVER = String.raw`
const port = Number(process.argv[1]);
try {
  Bun.serve({ hostname: '127.0.0.1', port, fetch: () => new Response('fake vite') });
} catch {
  console.error('error when starting dev server:\nError: Port ' + port + ' is already in use');
  process.exit(1);
}
console.log('  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://127.0.0.1:\x1b[1m' + port + '\x1b[22m/\x1b[39m');
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 500));
`;

/**
 * The stand-in for `bun run vite`. argv: <mode> <port> <marker>. Writes the
 * marker once running, then:
 *   serve     runs FAKE_VITE_SERVER as its own child, as `bun run` runs vite,
 *             and dies at once on SIGTERM while that child is still closing
 *   lose-race waits for someone else to take the port, then exits as vite does
 *   hang      never binds, never exits
 */
const FAKE_VITE = String.raw`
const [mode, portArg, marker] = process.argv.slice(1);
const port = Number(portArg);
if (marker) await Bun.write(marker, String(process.pid));
if (mode === 'serve') {
  const vite = Bun.spawn(['bun', '-e', ${JSON.stringify(FAKE_VITE_SERVER)}, '--', portArg], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  process.exit(await vite.exited);
} else if (mode === 'lose-race') {
  for (;;) {
    try {
      await fetch('http://127.0.0.1:' + port);
      break;
    } catch {
      await Bun.sleep(20);
    }
  }
  // Long enough for a poll loop to see the foreign server answer first.
  await Bun.sleep(1000);
  console.error('error when starting dev server:\nError: Port ' + port + ' is already in use');
  process.exit(1);
} else {
  setInterval(() => {}, 1000);
}
`;

type Mode = 'serve' | 'lose-race' | 'hang';

const fakeVite = (mode: Mode, port: number, marker = '') => [
  'bun',
  '-e',
  FAKE_VITE,
  '--',
  mode,
  String(port),
  marker,
];

/** What the harness should say about a port held by this test process. */
const THIS_PROCESS_AS_OWNER = Bun.which('lsof')
  ? `pid ${process.pid} `
  : 'an unidentified process';

const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A TCP server's port; Bun types it optional because of unix sockets. */
function boundPort(server: { port?: number }): number {
  if (server.port === undefined) throw new Error('server has no TCP port');
  return server.port;
}

/** Listens on `port` (0 picks one) as another checkout's vite would; returns the port. */
function foreignServer(port = 0): number {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: () => new Response('another checkout'),
  });
  cleanups.push(() => server.stop(true));
  return boundPort(server);
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response(),
  });
  const port = boundPort(probe);
  await probe.stop(true);
  return port;
}

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-server-test-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function settle<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ value, error: null }),
    (error: Error) => ({ value: null, error }),
  );
}

async function accepts(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the stand-in vite server on `port` with `dir` as its working directory,
 * as a checkout's vite runs from that checkout, and resolves once it listens.
 */
async function serverIn(dir: string, port: number) {
  const server = Bun.spawn(
    ['bun', '-e', FAKE_VITE_SERVER, '--', String(port)],
    {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  cleanups.push(async () => {
    server.kill('SIGKILL');
    await server.exited;
  });
  while (!(await accepts(`http://127.0.0.1:${port}`))) {
    if (server.exitCode !== null) throw new Error('stand-in server exited');
    await Bun.sleep(20);
  }
  return server;
}

describe('startDevServer port ownership', () => {
  test('refuses a port that is already listening, names the owner, and spawns nothing', async () => {
    const port = foreignServer();
    const marker = join(scratchDir(), 'spawned');

    const { value, error } = await settle(
      startDevServer({ port, command: fakeVite('serve', port, marker) }),
    );
    if (value) cleanups.push(() => value.stop());

    expect(error?.message).toContain(`Port ${port} is already in use`);
    expect(error?.message).toContain(THIS_PROCESS_AS_OWNER);
    expect(existsSync(marker)).toBe(false);
  }, 30000);

  test('fails when another server takes the port while its own is starting', async () => {
    const port = await freePort();
    const marker = join(scratchDir(), 'spawned');
    const starting = settle(
      startDevServer({ port, command: fakeVite('lose-race', port, marker) }),
    );

    // The marker means the child is running, so the pre-spawn probe has
    // already passed: whatever answers next is not the child.
    while (!existsSync(marker)) await Bun.sleep(20);
    foreignServer(port);

    const { value, error } = await starting;
    if (value) cleanups.push(() => value.stop());

    expect(value).toBeNull();
    expect(error?.message).toContain('exited before it started listening');
    expect(error?.message).toContain(`Port ${port} is already in use`);
    expect(error?.message).toContain(THIS_PROCESS_AS_OWNER);
  }, 30000);

  test('does not adopt a foreign server while its own child hangs', async () => {
    const port = await freePort();
    const marker = join(scratchDir(), 'spawned');
    const starting = settle(
      startDevServer({
        port,
        startupTimeoutMs: 4000,
        command: fakeVite('hang', port, marker),
      }),
    );

    while (!existsSync(marker)) await Bun.sleep(20);
    foreignServer(port);

    const { value, error } = await starting;
    if (value) cleanups.push(() => value.stop());

    expect(value).toBeNull();
    expect(error?.message).toContain(
      `Something answers on http://127.0.0.1:${port}`,
    );
    expect(error?.message).toContain(THIS_PROCESS_AS_OWNER);
  }, 30000);

  test('returns once its own server reports listening; stop outlasts the wrapper', async () => {
    const port = await freePort();
    const handle: DevServerHandle = await startDevServer({
      port,
      command: fakeVite('serve', port),
    });
    cleanups.push(() => handle.stop());

    const response = await fetch(handle.url);
    expect(await response.text()).toBe('fake vite');

    // The wrapper dies at once; the server under it holds the port for 500ms.
    await handle.stop();
    expect(await accepts(handle.url)).toBe(false);
  }, 30000);
});

describe('ensureDevServer checkout ownership', () => {
  test('refuses a server started from another directory, names it, and spawns nothing', async () => {
    const port = await freePort();
    const elsewhere = scratchDir();
    const holder = await serverIn(elsewhere, port);
    const marker = join(scratchDir(), 'spawned');

    const { value, error } = await settle(
      ensureDevServer(port, process.cwd(), {
        command: fakeVite('serve', port, marker),
      }),
    );
    if (value) cleanups.push(() => value.close());

    expect(value).toBeNull();
    expect(error?.message).toContain(`Port ${port} is already in use by`);
    expect(error?.message).toContain('--port <n>');
    if (Bun.which('lsof')) {
      expect(error?.message).toContain(
        `pid ${holder.pid} (bun) in ${realpathSync(elsewhere)}, which is not a dev server for this checkout`,
      );
    } else {
      expect(error?.message).toContain('cannot be confirmed as a dev server');
    }
    expect(existsSync(marker)).toBe(false);
  }, 30000);

  // Without lsof nothing can prove a server is this checkout's, so none is
  // reused; the refusal above covers that case.
  test.skipIf(!Bun.which('lsof'))(
    'reuses a server started from this checkout and leaves it running on close',
    async () => {
      const port = await freePort();
      // A temp dir is reached through a symlink on macOS (/var -> /private/var),
      // while lsof reports the resolved path; the comparison must agree.
      const checkout = scratchDir();
      await serverIn(checkout, port);
      const marker = join(scratchDir(), 'spawned');

      const server = await ensureDevServer(port, checkout, {
        command: fakeVite('serve', port, marker),
      });
      await server.close();

      expect(existsSync(marker)).toBe(false);
      const response = await fetch(`http://127.0.0.1:${port}`);
      expect(await response.text()).toBe('fake vite');
    },
    30000,
  );

  test('starts its own server on a free port; close frees the port for the next run', async () => {
    const port = await freePort();
    const checkout = scratchDir();
    const first = await ensureDevServer(port, checkout, {
      command: fakeVite('serve', port),
    });
    cleanups.push(() => first.close());
    const response = await fetch(`http://127.0.0.1:${port}`);
    expect(await response.text()).toBe('fake vite');

    // A script that starts one server per preset (lab:visual) calls again
    // right after close. The stand-in holds the port for 500ms after SIGTERM,
    // so a close that only signalled would hand the next call a dying server.
    await first.close();
    const marker = join(scratchDir(), 'spawned');
    const second = await ensureDevServer(port, checkout, {
      command: fakeVite('serve', port, marker),
    });
    cleanups.push(() => second.close());
    expect(existsSync(marker)).toBe(true);
  }, 30000);

  test('does not adopt a server that answers while its own child hangs', async () => {
    const port = await freePort();
    const marker = join(scratchDir(), 'spawned');
    const starting = settle(
      ensureDevServer(port, process.cwd(), {
        startupTimeoutMs: 4000,
        command: fakeVite('hang', port, marker),
      }),
    );

    // The marker means the child is running, so the ownership probe has
    // already found the port free: whatever answers next is not the child.
    while (!existsSync(marker)) await Bun.sleep(20);
    foreignServer(port);

    const { value, error } = await starting;
    if (value) cleanups.push(() => value.close());

    expect(value).toBeNull();
    expect(error?.message).toContain(
      `Something answers on http://127.0.0.1:${port}`,
    );
  }, 30000);
});
