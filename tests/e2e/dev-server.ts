/**
 * Shared dev-server harness for the browser end-to-end tests.
 *
 * Both e2e suites used to spawn vite themselves with `stdio: 'ignore'`, which
 * made a failed start indistinguishable from a slow one. The spawner now lives
 * in `scripts/dev-server.ts`, shared with the lab scripts: it captures the
 * server's output, passes `--strictPort`, kills by process group, and treats a
 * server as ready only once the child it spawned says it is listening.
 *
 * This file adds the e2e policy for a busy port: refuse it. When another
 * checkout's vite already held a suite's port (2–3 sessions run e2e suites
 * here at once), the suite used to test that checkout's code. The port is
 * probed before spawning, and the error names the process that holds it.
 */
import {
  type DevServerHandle,
  describePortOwner,
  isPortAccepting,
  spawnDevServer,
} from '../../scripts/dev-server.ts';

export type { DevServerHandle } from '../../scripts/dev-server.ts';
export { isResponsive } from '../../scripts/dev-server.ts';

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
  if (await isPortAccepting(port)) {
    throw new Error(
      `Port ${port} is already in use by ${await describePortOwner(port)}.\n` +
        "Refusing to start: this suite's vite would exit on --strictPort and " +
        'the tests would reach that process instead, usually another ' +
        "checkout's vite from a concurrent session. Stop it or wait for its " +
        'suite to finish. If two test files share this port, give one a new ' +
        'TEST_PORT (`bun run check:e2e-ports` lists the ports in use).',
    );
  }
  return spawnDevServer({ port, command, startupTimeoutMs });
}
