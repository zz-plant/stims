import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readlinkSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const script = path.join(
  process.cwd(),
  'scripts',
  'link-preinstalled-browsers.ts',
);

/**
 * Builds a browsers root shaped like the one cloud containers ship: a Chromium
 * build under a revision no Playwright release will ever pin, using the
 * pre-rename directory and binary names.
 */
async function createShippedBrowsersRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'stims-pw-browsers-'));

  const chromeDir = path.join(root, 'chromium-1', 'chrome-linux');
  await mkdir(chromeDir, { recursive: true });
  await writeFile(path.join(chromeDir, 'chrome'), '', { mode: 0o755 });
  await writeFile(path.join(chromeDir, 'icudtl.dat'), '');
  await writeFile(path.join(root, 'chromium-1', 'INSTALLATION_COMPLETE'), '');

  const shellDir = path.join(root, 'chromium_headless_shell-1', 'chrome-linux');
  await mkdir(shellDir, { recursive: true });
  await writeFile(path.join(shellDir, 'headless_shell'), '', { mode: 0o755 });
  await writeFile(
    path.join(root, 'chromium_headless_shell-1', 'INSTALLATION_COMPLETE'),
    '',
  );

  return root;
}

function run(root: string, args: string[] = []) {
  return spawnSync('bun', ['run', script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: root },
  });
}

function pinnedRevisionDirs(root: string, prefix: string) {
  return readdirSync(root).filter(
    (entry) => entry.startsWith(`${prefix}-`) && entry !== `${prefix}-1`,
  );
}

test('links a shipped Chromium into the layout the pinned Playwright expects', async () => {
  const root = await createShippedBrowsersRoot();
  try {
    const result = run(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('shipped revision 1');

    const [chromiumDir] = pinnedRevisionDirs(root, 'chromium');
    expect(chromiumDir).toBeDefined();
    const chromeShim = path.join(root, chromiumDir, 'chrome-linux64', 'chrome');
    expect(existsSync(chromeShim)).toBe(true);
    expect(readlinkSync(chromeShim)).toBe(
      path.join(root, 'chromium-1', 'chrome-linux', 'chrome'),
    );
    // Playwright rejects a revision directory without the completion marker.
    expect(
      existsSync(path.join(root, chromiumDir, 'INSTALLATION_COMPLETE')),
    ).toBe(true);

    // The pre-rename `headless_shell` binary is aliased to the name the pinned
    // Playwright launches, not just copied across under its old name.
    const [shellDir] = pinnedRevisionDirs(root, 'chromium_headless_shell');
    expect(shellDir).toBeDefined();
    const shellShim = path.join(
      root,
      shellDir,
      'chrome-headless-shell-linux64',
      'chrome-headless-shell',
    );
    expect(existsSync(shellShim)).toBe(true);
    expect(readlinkSync(shellShim)).toBe(
      path.join(
        root,
        'chromium_headless_shell-1',
        'chrome-linux',
        'headless_shell',
      ),
    );

    // The shipped build is never mutated.
    expect(existsSync(path.join(root, 'chromium-1', 'chrome-linux64'))).toBe(
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('--check reports the work without writing anything', async () => {
  const root = await createShippedBrowsersRoot();
  try {
    const result = run(root, ['--check']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Would link');
    expect(pinnedRevisionDirs(root, 'chromium')).toHaveLength(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('re-running is a no-op once the shim exists', async () => {
  const root = await createShippedBrowsersRoot();
  try {
    expect(run(root).status).toBe(0);

    const second = run(root);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('nothing to link');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('refuses to replace a real Playwright install', async () => {
  const root = await createShippedBrowsersRoot();
  try {
    // Claim the pinned revision directory without the shim marker, the way a
    // genuine `playwright install` would.
    const probe = run(root, ['--check']);
    expect(probe.status).toBe(0);

    const pinned = /chromium-(\d+) ->/.exec(probe.stdout)?.[1];
    expect(pinned).toBeDefined();
    await mkdir(path.join(root, `chromium-${pinned}`, 'chrome-linux64'), {
      recursive: true,
    });

    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'refusing to replace a real Playwright install',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reports the surviving tooling when no shipped build can stand in', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stims-pw-empty-'));
  try {
    const result = run(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('lab:reactivity');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
