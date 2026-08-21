import { afterAll, beforeAll, expect } from 'bun:test';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { playToy } from '../../scripts/play-toy.ts';
import {
  hasChromium,
  localOnlyBrowserTest,
  requiredBrowserTest,
} from './browser-availability.ts';
import {
  type DevServerHandle,
  isResponsive,
  startDevServer,
} from './dev-server.ts';
import { WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const integrationTest = requiredBrowserTest;
// Headless Chromium on Linux CI blocks AudioContext resume without a trusted
// user gesture; enableDemoAudio's programmatic click() is untrusted and hangs
// for the full budget. The agent API works on a real (or macOS headless)
// browser, so run this case locally and skip it on CI.
const gestureGatedTest = localOnlyBrowserTest;
const TEST_PORT = 5180;
// 180s, not 90s: this job runs after several other SwiftShader-rendered e2e
// suites in the same CI job, and accumulated GPU/CPU pressure has pushed
// this test past a 90s budget in CI even though it completes in ~10s
// locally with real GPU (2026-08-06 CI investigation).
const INTEGRATION_TIMEOUT_MS = 180000;
let devServer: DevServerHandle | null = null;

async function startDevServerInstance() {
  devServer = await startDevServer({ port: TEST_PORT });
}

async function stopDevServerInstance() {
  const server = devServer;
  devServer = null;
  await server?.stop();
}

/**
 * Re-checks the shared dev server before each test and restarts it if it has
 * stopped answering.
 *
 * The probe must be bounded. This used to call bare `fetch`, which hangs
 * indefinitely when vite is alive-but-wedged rather than dead — the socket is
 * accepted and no response ever arrives. Because every test starts here, the
 * hang landed before any navigation or logging, so the suite reported only
 * "timed out after 180000ms" against whichever test drew the short straw,
 * with no clue where it stopped. Which test that was moved between runs,
 * which is what made it look like flakiness rather than a fixed bug.
 */
async function ensureDevServer() {
  if (!devServer) {
    await startDevServerInstance();
    return;
  }
  if (await isResponsive(`http://127.0.0.1:${TEST_PORT}/`)) {
    return;
  }
  await stopDevServerInstance();
  await startDevServerInstance();
}

async function createMobilePage() {
  const browser = await chromium.launch({
    args: WEBGL_RENDERER_ARGS,
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

  const closeBrowser = async () => {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
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

  await startDevServerInstance();
}, 60000);

afterAll(async () => {
  await stopDevServerInstance();
}, 30000);

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

integrationTest(
  'agents can launch and capture milkdrop',
  async () => {
    await ensureDevServer();
    const outputDir = await mkdtemp(path.join(tmpdir(), 'stims-agent-'));

    try {
      const result = await playToy({
        slug: 'milkdrop',
        screenshot: true,
        duration: 1000,
        outputDir,
        port: TEST_PORT,
        audioMode: 'none',
        viewportWidth: 640,
        viewportHeight: 360,
      });

      expect(result.success).toBe(true);
      expect(result.audioActive).toBe(false);
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

// These two assert the product's headline objective as *behavior*: audio has
// to actually start. The suite's source-text assertions cannot catch a demo
// button being removed from the shell, which is exactly how one-click demo
// audio regressed out of the UI while every test stayed green.
integrationTest(
  'one click on the demo source card starts demo audio',
  async () => {
    await ensureDevServer();
    const mobile = await createMobilePage();

    try {
      await mobile.page.goto(`http://127.0.0.1:${TEST_PORT}/?agent=true`);
      await mobile.page.waitForSelector('#use-demo-audio');
      await mobile.page.click('#use-demo-audio');

      await mobile.page.waitForFunction(
        () => window.stimState?.getState().audioActive === true,
        undefined,
        { timeout: 45000 },
      );

      const state = await mobile.page.evaluate(() =>
        window.stimState?.getState(),
      );
      expect(state?.audioActive).toBe(true);
      expect(state?.audioSource).toBe('demo');
    } finally {
      await mobile.close();
    }
  },
  { timeout: INTEGRATION_TIMEOUT_MS },
);

gestureGatedTest(
  'window.stimState.enableDemoAudio() activates audio for direct callers',
  async () => {
    await ensureDevServer();
    const mobile = await createMobilePage();

    try {
      await mobile.page.goto(`http://127.0.0.1:${TEST_PORT}/?agent=true`);
      await mobile.page.waitForSelector('#use-demo-audio');

      const result = await mobile.page.evaluate(async () => {
        try {
          await window.stimState?.enableDemoAudio();
          return { ok: true, error: null };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      expect(result.error).toBeNull();
      expect(result.ok).toBe(true);

      const state = await mobile.page.evaluate(() =>
        window.stimState?.getState(),
      );
      expect(state?.audioActive).toBe(true);
      expect(state?.audioSource).toBe('demo');
    } finally {
      await mobile.close();
    }
  },
  { timeout: INTEGRATION_TIMEOUT_MS },
);

integrationTest(
  'agents can detect failing toy',
  async () => {
    await ensureDevServer();
    const mobile = await createMobilePage();

    try {
      await mobile.page.goto(
        `http://127.0.0.1:${TEST_PORT}/milkdrop/?agent=true&experience=non-existent-toy-slug&renderer=webgl`,
        { waitUntil: 'domcontentloaded' },
      );
      // The agent-facing failure signal is the error status the shell
      // renders for a slug no toy exists under. This used to go through
      // playToy, whose preflight probes (each `page.evaluate` defaulting to
      // a 30s Playwright timeout) piled up against the full app boot on
      // CI's 2-core SwiftShader runner and blew the 180s budget without
      // ever asserting. Navigate straight to the route and assert the error
      // DOM instead: same contract, a fraction of the work.
      await mobile.page.waitForSelector('.active-toy-status.is-error', {
        timeout: 60000,
      });
      const message = await mobile.page.evaluate(
        () =>
          document
            .querySelector('.active-toy-status.is-error p')
            ?.textContent?.trim() ?? '',
      );
      expect(message).toContain('non-existent-toy-slug');
    } finally {
      await mobile.close();
    }
  },
  { timeout: 90000 },
);
