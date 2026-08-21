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
import { closeQuietly, withDeadline } from './deadline.ts';
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
// Launching Chromium and bringing the dev server back are the two setup steps
// that can wait on something wedged, and neither carries a timeout of its own.
const LAUNCH_TIMEOUT_MS = 60_000;
const DEV_SERVER_TIMEOUT_MS = 90_000;
// evaluate() takes no timeout at all, and the one here runs *inside* a failure
// path — exactly when the page has stopped answering.
const EVALUATE_TIMEOUT_MS = 15_000;
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
  await withDeadline(
    (async () => {
      if (!devServer) {
        await startDevServerInstance();
        return;
      }
      if (await isResponsive(`http://127.0.0.1:${TEST_PORT}/`)) {
        return;
      }
      await stopDevServerInstance();
      await startDevServerInstance();
    })(),
    DEV_SERVER_TIMEOUT_MS,
    'restarting the shared dev server',
  );
}

async function createMobilePage() {
  const browser = await withDeadline(
    chromium.launch({ args: WEBGL_RENDERER_ARGS }),
    LAUNCH_TIMEOUT_MS,
    'launching Chromium',
  );
  const context = await withDeadline(
    browser.newContext({
      viewport: { width: 430, height: 932 },
      isMobile: true,
      hasTouch: true,
    }),
    LAUNCH_TIMEOUT_MS,
    'opening a browser context',
  );
  const page = await withDeadline(
    context.newPage(),
    LAUNCH_TIMEOUT_MS,
    'opening a page',
  );
  await page.addInitScript(() => {
    window.localStorage.setItem('stims:onboarding-complete', 'true');
  });

  const closeBrowser = async () => {
    await closeQuietly(context, browser);
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
      // waitForSelector resolves on *attached*, but this CTA renders
      // `disabled={!isEngineReady || isStarting}` and engineReady is just
      // `catalogError === null` (workspace-shell-hooks.ts). click() then
      // auto-waits for enabled with no deadline of its own, so a failed
      // catalog fetch turned this into a silent hang that ate the whole test
      // budget and reported a timeout naming no cause. Wait for enabled
      // explicitly, and bound the click, so each failure says which it was.
      await mobile.page.waitForFunction(
        () => {
          const btn = document.querySelector(
            '#use-demo-audio',
          ) as HTMLButtonElement | null;
          return Boolean(btn) && !btn?.disabled;
        },
        undefined,
        { timeout: 60000 },
      );
      await mobile.page.click('#use-demo-audio', { timeout: 30000 });

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
      // The canonical route, not the /milkdrop/ alias. The alias is a
      // client-side redirect, so going through it costs a second document
      // load before the shell even starts booting — on CI's 2-core
      // SwiftShader runner that hop was pure overhead against this test's
      // budget, and the alias has its own coverage in the SEO guard.
      await mobile.page.goto(
        `http://127.0.0.1:${TEST_PORT}/?agent=true&experience=non-existent-toy-slug&renderer=webgl`,
        { waitUntil: 'domcontentloaded', timeout: 30000 },
      );

      // Two waits, not one, because they fail for different reasons and the
      // difference is the whole diagnosis. The error status is plain
      // URL-derived React state with no engine involvement, so if the shell
      // has mounted and the status is still missing, routing is broken; if
      // the shell itself never mounts, the app did not boot. Collapsed into
      // a single 60s wait, both looked identical — and when the boot ran
      // long, the wait outlived the test's own budget, so the suite reported
      // a bare "timed out" naming neither.
      await mobile.page.waitForSelector('#stims-main', { timeout: 30000 });
      const message = await mobile.page
        .waitForSelector('.active-toy-status.is-error p', { timeout: 20000 })
        .then((handle) => handle.textContent())
        .then((text) => text?.trim() ?? '')
        .catch(async (error) => {
          // Name what the page actually showed instead. Without this the
          // only artifact of a failure here is the selector string.
          const shellState = await withDeadline(
            mobile.page.evaluate(() => ({
              url: window.location.href,
              readyState: document.readyState,
              hasShell: Boolean(document.getElementById('stims-main')),
              statusText:
                document
                  .querySelector('.active-toy-status')
                  ?.textContent?.trim() ?? null,
            })),
            EVALUATE_TIMEOUT_MS,
            'reading the shell state after the error status never rendered',
          ).catch(() => null);
          throw new Error(
            `Error status never rendered: ${JSON.stringify(shellState)} (${
              (error as Error).message
            })`,
          );
        });
      expect(message).toContain('non-existent-toy-slug');
    } finally {
      await mobile.close();
    }
  },
  // The waits inside sum to 80s (30 + 30 + 20) before the browser launch and
  // the dev-server check are counted, so 90s could expire *during* the last
  // wait — killing the test before the wait it was stuck in could name itself,
  // which is the bare "timed out after 90000ms" CI kept reporting and the
  // whole reason these waits are split. Every other test in this file already
  // budgets INTEGRATION_TIMEOUT_MS; this one was left behind.
  { timeout: INTEGRATION_TIMEOUT_MS },
);
