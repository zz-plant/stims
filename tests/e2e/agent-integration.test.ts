import { afterAll, beforeAll, expect, test } from 'bun:test';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { playToy } from '../../scripts/play-toy.ts';

const chromiumPath = chromium.executablePath();
const hasChromium = fs.existsSync(chromiumPath);
const integrationTest = hasChromium ? test : test.skip;
const flakyIntegrationTest = hasChromium
  ? (
      name: string,
      fn: () => Promise<void>,
      options?: { timeout?: number; retry?: number },
    ) => test(name, fn, { retry: 2, ...options })
  : test.skip;
const TEST_PORT = 5180;
const PLAYWRIGHT_RENDERER_ARGS = [
  '--use-angle=swiftshader',
  '--use-gl=angle',
  '--enable-webgl',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];
const INTEGRATION_TIMEOUT_MS = 90000;
const SERVER_START_TIMEOUT_MS = 45000;
let devServer: ChildProcess | null = null;

function isDevServerRunning() {
  return (
    devServer !== null &&
    devServer.exitCode === null &&
    devServer.signalCode === null
  );
}

async function stopDevServer() {
  if (!devServer) {
    return;
  }

  const server = devServer;
  devServer = null;
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
}

async function startDevServer() {
  devServer = spawn(
    process.execPath,
    ['run', 'vite', '--host', '127.0.0.1', '--port', String(TEST_PORT)],
    {
      stdio: 'ignore',
      cwd: process.cwd(),
    },
  );

  await waitForServer(`http://127.0.0.1:${TEST_PORT}/`);
}

async function ensureDevServer() {
  if (!isDevServerRunning()) {
    await stopDevServer();
    await startDevServer();
    return;
  }

  try {
    await waitForServer(`http://127.0.0.1:${TEST_PORT}/`, 3000);
  } catch (_error) {
    await stopDevServer();
    await startDevServer();
  }
}

async function waitForServer(url: string, timeoutMs = SERVER_START_TIMEOUT_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (_error) {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for dev server at ${url}`);
}

async function createMobilePage() {
  const browser = await chromium.launch({
    args: PLAYWRIGHT_RENDERER_ARGS,
  });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.localStorage.setItem('stims:onboarding-complete', 'true');
  });

  const forceCloseChromium = () => {
    spawnSync('pkill', ['-f', 'playwright_chromiumdev_profile'], {
      stdio: 'ignore',
    });
  };

  const closeBrowser = async () => {
    await context.close().catch(() => {});
    const closeResult = await Promise.race([
      browser
        .close()
        .then(() => 'closed' as const)
        .catch(() => 'closed' as const),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), 1500);
      }),
    ]);
    if (closeResult === 'timeout') {
      forceCloseChromium();
    }
  };

  return {
    browser,
    context,
    page,
    close: closeBrowser,
  };
}

beforeAll(async () => {
  if (!hasChromium) return;

  await startDevServer();
}, 60000);

afterAll(async () => {
  await stopDevServer();
});

integrationTest(
  'homepage root renders the milkdrop launch shell',
  async () => {
    await ensureDevServer();
    const mobile = await createMobilePage();

    try {
      await mobile.page.goto(`http://127.0.0.1:${TEST_PORT}/`);
      await mobile.page.waitForSelector('[data-audio-controls]');

      const launchpadState = await mobile.page.evaluate(() => ({
        pathname: window.location.pathname,
        hasAudioControls: Boolean(
          document.querySelector('[data-audio-controls]'),
        ),
      }));

      expect(launchpadState.pathname).toBe('/');
      expect(launchpadState.hasAudioControls).toBe(true);
    } finally {
      await mobile.close();
    }
  },
  { timeout: 45000 },
);

flakyIntegrationTest(
  'agents can launch and capture milkdrop',
  async () => {
    await ensureDevServer();
    const outputDir = await mkdtemp(path.join(tmpdir(), 'stims-agent-'));

    try {
      const result = await playToy({
        slug: 'milkdrop',
        screenshot: true,
        duration: 3000,
        outputDir,
        port: TEST_PORT,
      });

      expect(result.success).toBe(true);
      expect(result.audioActive).toBe(true);
      expect(result.screenshot).toBeTruthy();
      expect(result.screenshot ? fs.existsSync(result.screenshot) : false).toBe(
        true,
      );
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  },
  { timeout: INTEGRATION_TIMEOUT_MS },
);

flakyIntegrationTest(
  'agents can detect failing toy',
  async () => {
    await ensureDevServer();
    const result = await playToy({
      slug: 'non-existent-toy-slug',
      duration: 1000,
      port: TEST_PORT,
    });

    expect(result.success).toBe(false);
  },
  { timeout: INTEGRATION_TIMEOUT_MS },
);
