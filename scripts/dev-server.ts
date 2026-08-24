import { spawn } from 'node:child_process';

export type DevServer = {
  close: () => void;
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

export async function ensureDevServer(
  port = 5173,
  repoRoot = process.cwd(),
): Promise<DevServer> {
  if (await isPortOpen(port)) {
    console.log(`Dev server already running on port ${port}`);
    return { close: () => {} };
  }

  console.log(`Starting Vite dev server on port ${port}...`);
  const child = spawn(
    process.execPath,
    [
      './node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, BROWSER: 'none' },
    },
  );

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Vite exited before the dev server could be started.');
    }
    if (await isPortOpen(port)) {
      console.log(`Dev server started on port ${port}`);
      return {
        close: () => {
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
  throw new Error(`Timed out waiting for Vite on port ${port}.`);
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
      return { close: () => {} };
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
        close: () => {
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
