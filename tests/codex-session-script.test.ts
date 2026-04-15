import { afterEach, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const task = cleanupTasks.pop();
    if (task) {
      await task();
    }
  }
});

function sessionDir(rootDir: string, host: string, port: number) {
  return path.join(rootDir, `${host}-${port}`);
}

async function writeSessionMetadata({
  rootDir,
  host,
  port,
  profile,
  watchMode,
  modelRoles,
  devPid,
  watchPid,
}: {
  rootDir: string;
  host: string;
  port: number;
  profile: string;
  watchMode: string;
  modelRoles: string;
  devPid?: number;
  watchPid?: number;
}) {
  const dir = sessionDir(rootDir, host, port);
  await mkdir(dir, { recursive: true });

  const devPidfile = path.join(dir, 'dev-server.pid');
  const devLogfile = path.join(dir, 'dev-server.log');
  const watchPidfile =
    watchMode === 'unit'
      ? path.join(dir, 'unit-test-watch.pid')
      : path.join(dir, 'typecheck-watch.pid');
  const watchLogfile =
    watchMode === 'unit'
      ? path.join(dir, 'unit-test-watch.log')
      : path.join(dir, 'typecheck-watch.log');
  const watchName =
    watchMode === 'unit' ? 'unit-test watcher' : 'typecheck watcher';

  if (typeof devPid === 'number') {
    await writeFile(devPidfile, `${devPid}\n`);
  }

  if (typeof watchPid === 'number') {
    await writeFile(watchPidfile, `${watchPid}\n`);
  }

  const metadataFile = path.join(dir, 'session.meta');
  await writeFile(
    metadataFile,
    [
      `session_key=${host}-${port}`,
      `host=${host}`,
      `port=${port}`,
      `profile=${profile}`,
      `watch_mode=${watchMode}`,
      `model_roles=${modelRoles}`,
      `url=http://${host}:${port}/`,
      `dev_server_managed=true`,
      `dev_pidfile=${devPidfile}`,
      `dev_logfile=${devLogfile}`,
      `watcher_managed=${typeof watchPid === 'number' ? 'true' : 'false'}`,
      `watch_name=${watchName}`,
      `watch_pidfile=${watchPidfile}`,
      `watch_logfile=${watchLogfile}`,
      '',
    ].join('\n'),
  );

  return {
    metadataFile,
  };
}

function spawnSleep() {
  const child = spawn('sleep', ['60'], {
    stdio: 'ignore',
  });

  cleanupTasks.push(async () => {
    child.kill('SIGKILL');
  });

  return child;
}

function requirePid(pid: number | undefined) {
  expect(pid).toBeDefined();
  return pid as number;
}

async function waitForExit(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for child process to exit.'));
    }, 3000);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

test('codex session script prints a review profile plan', () => {
  const result = spawnSync(
    'bash',
    [
      'scripts/codex-session.sh',
      '--print-plan',
      '--profile',
      'review',
      '--skip-models',
      '--skip-dev-server',
      '--skip-watch',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Profile: review');
  expect(result.stdout).toContain('Local models: skipped');
  expect(result.stdout).toContain('Dev server: skipped');
  expect(result.stdout).toContain('Watcher: skipped');
});

test('codex session script maps compat profile to the compatibility watcher', () => {
  const result = spawnSync(
    'bash',
    [
      'scripts/codex-session.sh',
      '--print-plan',
      '--profile',
      'compat',
      '--skip-models',
      '--skip-dev-server',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Profile: compat');
  expect(result.stdout).toContain('Watcher: compatibility watcher');
});

test('codex session status reports persisted session metadata instead of CLI defaults', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'stims-codex-session-'));
  cleanupTasks.push(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  const dev = spawnSleep();
  const watcher = spawnSleep();

  await writeSessionMetadata({
    rootDir,
    host: '127.0.0.1',
    port: 4173,
    profile: 'full',
    watchMode: 'unit',
    modelRoles: 'fast,quality',
    devPid: dev.pid,
    watchPid: watcher.pid,
  });

  const result = spawnSync('bash', ['scripts/codex-session.sh', '--status'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_SESSION_DIR: rootDir,
    },
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Session: 127.0.0.1:4173');
  expect(result.stdout).toContain('Profile: full');
  expect(result.stdout).toContain('Watcher mode: unit');
  expect(result.stdout).toContain('dev server: running');
  expect(result.stdout).toContain('unit-test watcher: running');
});

test('codex session stop is scoped to the requested port', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'stims-codex-stop-'));
  cleanupTasks.push(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  const dev4173 = spawnSleep();
  const watch4173 = spawnSleep();
  const dev5173 = spawnSleep();

  const session4173 = await writeSessionMetadata({
    rootDir,
    host: '127.0.0.1',
    port: 4173,
    profile: 'full',
    watchMode: 'unit',
    modelRoles: 'fast,quality',
    devPid: dev4173.pid,
    watchPid: watch4173.pid,
  });
  const session5173 = await writeSessionMetadata({
    rootDir,
    host: '127.0.0.1',
    port: 5173,
    profile: 'review',
    watchMode: 'typecheck',
    modelRoles: 'fast,quality',
    devPid: dev5173.pid,
  });

  const result = spawnSync(
    'bash',
    ['scripts/codex-session.sh', '--port', '4173', '--stop'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEX_SESSION_DIR: rootDir,
      },
    },
  );

  expect(result.status).toBe(0);
  await waitForExit(dev4173);
  await waitForExit(watch4173);
  expect(() => process.kill(requirePid(dev5173.pid), 0)).not.toThrow();

  await expect(readFile(session5173.metadataFile, 'utf8')).resolves.toContain(
    'port=5173',
  );
  await expect(readFile(session4173.metadataFile, 'utf8')).rejects.toThrow();
});
