import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const cleanupTasks: Array<() => Promise<void>> = [];
const sourceSetupScript = path.join(process.cwd(), 'scripts', 'codex-setup.sh');

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const task = cleanupTasks.pop();
    if (task) {
      await task();
    }
  }
});

async function createTempRepo() {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'stims-codex-setup-'));
  cleanupTasks.push(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  await mkdir(path.join(rootDir, 'scripts'), { recursive: true });
  await writeFile(
    path.join(rootDir, 'package.json'),
    JSON.stringify({ name: 'stims-test' }, null, 2),
  );
  await writeFile(path.join(rootDir, 'bun.lock'), 'lockfile-v1\n');
  await writeFile(
    path.join(rootDir, 'scripts', 'codex-setup.sh'),
    await readFile(sourceSetupScript, 'utf8'),
    { mode: 0o755 },
  );

  return rootDir;
}

async function installFakeBun(
  rootDir: string,
  {
    bunVersion = '1.3.4',
  }: {
    bunVersion?: string;
  } = {},
) {
  const fakeBinDir = path.join(rootDir, 'bin');
  const bunLogFile = path.join(rootDir, 'bun.log');
  const bunPath = path.join(fakeBinDir, 'bun');

  await mkdir(fakeBinDir, { recursive: true });
  await writeFile(bunLogFile, '');
  await writeFile(
    bunPath,
    `#!/usr/bin/env bash
set -euo pipefail
bun_log_file=${JSON.stringify(bunLogFile)}
if [[ "$#" -gt 0 ]]; then
  printf '%s\\n' "$*" >>"$bun_log_file"
fi
if [[ "\${1:-}" == "--version" ]]; then
  echo ${JSON.stringify(bunVersion)}
  exit 0
fi
if [[ "\${1:-}" == "install" ]]; then
  mkdir -p node_modules
  exit 0
fi
if [[ "\${1:-}" == "run" && "\${2:-}" == "check:quick" ]]; then
  exit 0
fi
if [[ "\${1:-}" == "run" && "\${2:-}" == "check" ]]; then
  exit 0
fi
echo "unexpected bun invocation: $*" >&2
exit 99
`,
    { mode: 0o755 },
  );

  return {
    bunLogFile,
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:/usr/bin:/bin`,
    },
  };
}

function readLoggedBunInvocations(logContents: string) {
  return logContents
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function manifestFingerprint(rootDir: string) {
  const result = spawnSync(
    'bash',
    [
      '-lc',
      `
        set -euo pipefail
        cd ${JSON.stringify(rootDir)}
        {
          for rel in package.json bun.lock bunfig.toml .bun-version; do
            if [[ -f "$rel" ]]; then
              printf '%s ' "$rel"
              cksum "$rel"
            fi
          done
        } | cksum | awk '{print $1 ":" $2}'
      `,
    ],
    {
      encoding: 'utf8',
    },
  );

  expect(result.status).toBe(0);
  return result.stdout.trim();
}

test('codex setup script prints the plan without running install or checks', async () => {
  const rootDir = await createTempRepo();
  const { bunLogFile, env } = await installFakeBun(rootDir);

  const result = spawnSync('bash', ['scripts/codex-setup.sh', '--print-plan'], {
    cwd: rootDir,
    encoding: 'utf8',
    env,
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Plan');
  expect(result.stdout).toContain('Install: bun install');
  expect(result.stdout).toContain('Checks: bun run check:quick');

  const bunLog = await readFile(bunLogFile, 'utf8');
  const bunInvocations = readLoggedBunInvocations(bunLog);

  expect(bunInvocations.length).toBeGreaterThan(0);
  expect(bunInvocations.every((line) => line === '--version')).toBe(true);
});

test('codex setup script skips install when cached dependencies look current', async () => {
  const rootDir = await createTempRepo();
  const { bunLogFile, env } = await installFakeBun(rootDir);

  await mkdir(path.join(rootDir, 'node_modules'), { recursive: true });
  await mkdir(path.join(rootDir, '.codex', 'setup'), { recursive: true });
  await writeFile(
    path.join(rootDir, '.codex', 'setup', 'install-state.meta'),
    `fingerprint=${manifestFingerprint(rootDir)}
bun_version=1.3.4
installed_at=2026-04-15T12:00:00-0500
`,
  );

  const result = spawnSync('bash', ['scripts/codex-setup.sh'], {
    cwd: rootDir,
    encoding: 'utf8',
    env,
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(
    'Skipping dependency installation; node_modules and manifest fingerprint are current',
  );
  expect(result.stdout).toContain(
    'Running quick quality gate (bun run check:quick)',
  );

  const bunLog = await readFile(bunLogFile, 'utf8');
  const bunInvocations = readLoggedBunInvocations(bunLog);

  expect(bunInvocations).toContain('run check:quick');
  expect(bunInvocations).not.toContain('install');
});

test('codex setup status reports missing installs and suggests setup', async () => {
  const rootDir = await createTempRepo();
  const { env } = await installFakeBun(rootDir);

  const result = spawnSync('bash', ['scripts/codex-setup.sh', '--status'], {
    cwd: rootDir,
    encoding: 'utf8',
    env,
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Local setup status for stims');
  expect(result.stdout).toContain('- Dependency install: missing');
  expect(result.stdout).toContain('- Suggested next step: bun run setup');
});
