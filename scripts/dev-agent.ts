/**
 * `bun run dev:agent` — one warm feedback loop for agent sessions.
 *
 * Runs the dev server (canonical `?agent=true` route), a quiet typecheck
 * watcher, and the fast test suite in watch mode together. Any of the three
 * exiting (or Ctrl-C) stops the rest.
 */

import { spawn } from 'node:child_process';

const commands: Array<{ name: string; cmd: string[] }> = [
  { name: 'vite', cmd: ['bun', 'run', 'dev'] },
  {
    name: 'typecheck (watch)',
    cmd: [
      'bun',
      '--bun',
      './node_modules/typescript/bin/tsc',
      '--noEmit',
      '--watch',
      '--preserveWatchOutput',
    ],
  },
  {
    name: 'unit tests (watch)',
    cmd: ['bun', 'run', 'scripts/run-tests.ts', '--profile', 'fast', '--watch'],
  },
];

const procs = commands.map(({ name, cmd }) => {
  const isPosix = process.platform !== 'win32';
  const proc = spawn(cmd[0], cmd.slice(1), {
    stdio: 'inherit',
    detached: isPosix,
  });
  proc.on('exit', (code) => {
    console.log(`[dev:agent] ${name} exited (${code ?? 'signal'})`);
  });
  return { name, proc };
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { proc } of procs) {
    try {
      if (proc.pid && process.platform !== 'win32') {
        process.kill(-proc.pid, 'SIGTERM');
      } else {
        proc.kill('SIGTERM');
      }
    } catch {}
  }
  setTimeout(() => {
    for (const { proc } of procs) {
      try {
        if (proc.pid && process.platform !== 'win32') {
          process.kill(-proc.pid, 'SIGKILL');
        } else {
          proc.kill('SIGKILL');
        }
      } catch {}
    }
  }, 1000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await new Promise<void>((resolve) => {
  for (const { proc } of procs) {
    proc.once('exit', () => {
      shutdown();
      resolve();
    });
  }
});
