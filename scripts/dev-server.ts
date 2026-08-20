import { spawn } from 'node:child_process';

export type DevServer = {
  close: () => void;
};

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
