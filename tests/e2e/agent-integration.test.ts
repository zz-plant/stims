import { afterAll, beforeAll, expect } from 'bun:test';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Browser, chromium } from 'playwright';
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

/**
 * One Chromium for the whole file, a fresh context per test.
 *
 * Each test used to launch its own browser. CI failed on the fifth with
 * `Timed out after 60000ms while launching Chromium` — not a slow page, a
 * browser process that could not start, because by then the 2-core runner was
 * carrying the remains of four others. The symptom kept moving earlier as the
 * machine degraded (first a stuck wait, then a 30s navigation, then the launch
 * itself), which is the signature of resource exhaustion rather than of any
 * one call being wrong.
 *
 * A context is the isolation boundary these tests actually need — separate
 * storage, cookies and pages — so sharing the process costs nothing and
 * removes four launches from the run.
 */
let sharedBrowser: Browser | null = null;

async function launchSharedBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  sharedBrowser = await withDeadline(
    chromium.launch({ args: WEBGL_RENDERER_ARGS }),
    LAUNCH_TIMEOUT_MS,
    'launching the shared Chromium',
  );
  return sharedBrowser;
}

async function createMobilePage() {
  const browser = await launchSharedBrowser();
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
  // A crashed renderer does not make Playwright throw — the next wait just
  // never resolves and reports a timeout on the selector, which reads as
  // "the app never rendered" when the truth is "the tab died".
  page.on('crash', () => {
    console.error(
      `[e2e] RENDERER CRASHED on ${page.url()} — any timeout after this ` +
        'line is a consequence, not the cause.',
    );
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('stims:onboarding-complete', 'true');
  });

  return {
    browser,
    context,
    page,
    // Only the context: the browser outlives the test.
    close: async () => {
      await closeQuietly(context);
    },
  };
}

beforeAll(async () => {
  if (!hasChromium) return;

  await startDevServerInstance();
}, 60000);

afterAll(async () => {
  if (sharedBrowser) {
    await closeQuietly(sharedBrowser);
    sharedBrowser = null;
  }
  await stopDevServerInstance();
}, 30000);

integrationTest(
  'homepage root renders the milkdrop launch shell',
  async () => {
    await ensureDevServer();
    const mobile = await createMobilePage();

    try {
      await mobile.page.goto(`http://127.0.0.1:${TEST_PORT}/`, {
        timeout: 30000,
      });
      await mobile.page.waitForSelector('[data-audio-controls]', {
        timeout: 30000,
      });

      const launchpadState = await withDeadline(
        mobile.page.evaluate(() => ({
          pathname: window.location.pathname,
          hasAudioControls: Boolean(
            document.querySelector('[data-audio-controls]'),
          ),
        })),
        15000,
        'reading the launchpad route and audio-control presence',
      );

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
      await mobile.page.goto(`http://127.0.0.1:${TEST_PORT}/?agent=true`, {
        timeout: 30000,
      });
      await mobile.page.waitForSelector('#use-demo-audio', { timeout: 30000 });
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

      const state = await withDeadline(
        mobile.page.evaluate(() => window.stimState?.getState()),
        15000,
        'reading window.stimState.getState() back out of the page',
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
      await mobile.page.goto(`http://127.0.0.1:${TEST_PORT}/?agent=true`, {
        timeout: 30000,
      });
      await mobile.page.waitForSelector('#use-demo-audio', { timeout: 30000 });

      const result = await withDeadline(
        mobile.page.evaluate(async () => {
          try {
            await window.stimState?.enableDemoAudio();
            return { ok: true, error: null };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
        30000,
        'calling window.stimState.enableDemoAudio() in the page',
      );

      expect(result.error).toBeNull();
      expect(result.ok).toBe(true);

      const state = await withDeadline(
        mobile.page.evaluate(() => window.stimState?.getState()),
        15000,
        'reading window.stimState.getState() back out of the page',
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
      // 60s because this navigation is being starved, not because it is
      // slow. Reproduced locally with `taskset -c 0,1`, which fails this
      // deterministically where a 4-core run does not, and the measured
      // chain is:
      //
      //   an earlier test's page wedges -> its close() hangs (its siblings
      //   close in 19ms-2.6s; that one never returned even given 10
      //   minutes) -> closeQuietly abandons it at 15s and leaks a live
      //   browser -> the leaked browser keeps burning CPU in its rAF loop
      //   -> on two cores this goto never gets scheduled.
      //
      // So the bound is a backstop, not a cure: see #1123. The route is
      // fine -- navigated in isolation it reaches domcontentloaded in 2.5s
      // and renders the error text within 2s.
      //
      // Two earlier explanations in this spot were wrong and are recorded
      // so they are not retried: cold vite transforms (ruled out -- raising
      // 30s -> 60s did not help), and plain CPU slowness (ruled out -- the
      // leak, not the load, is what starves it).
      await mobile.page.goto(
        `http://127.0.0.1:${TEST_PORT}/?agent=true&experience=non-existent-toy-slug&renderer=webgl`,
        // 60s, not the 30s default. This is the fifth browser this file
        // launches in a run, and CI reported `goto: Timeout 30000ms exceeded`
        // here while the identical navigation in the tests above — on the
        // slower `load` wait, no less — finished in single-digit seconds. The
        // page is not stuck, the 2-core SwiftShader runner is just saturated
        // by that point, so the first navigation needs room rather than a
        // tighter bound. Still well inside the test budget: 60 + 30 + 20 plus
        // setup stays under INTEGRATION_TIMEOUT_MS.
        { waitUntil: 'domcontentloaded', timeout: 60000 },
      );

      // Two waits, not one, because they fail for different reasons and the
      // difference is the whole diagnosis. The error status is plain
      // URL-derived React state with no engine involvement, so if the shell
      // has mounted and the status is still missing, routing is broken; if
      // the shell itself never mounts, the app did not boot. Collapsed into
      // a single 60s wait, both looked identical — and when the boot ran
      // long, the wait outlived the test's own budget, so the suite reported
      // a bare "timed out" naming neither.
      // Note this waits for *visible*, not attached. 30s, matching the
      // budget arithmetic in the comment on this test's timeout below
      // (60 + 30 + 20 plus setup, inside INTEGRATION_TIMEOUT_MS). An
      // earlier revision of this branch raised it to 60s to survive a
      // browser leak; #1136 removed the leak by sharing one Chromium, and
      // main is green on 30s, so the larger value would only have broken
      // that sum for no benefit.
      await mobile.page.waitForSelector('#stims-main', { timeout: 30000 });
      const message = await mobile.page
        .waitForSelector('.active-toy-status.is-error p', { timeout: 20000 })
        .then((handle) => handle.textContent())
        .then((text) => text?.trim() ?? '')
        .catch(async (error) => {
          // Name what the page actually showed instead. Without this the
          // only artifact of a failure here is the selector string.
          // Bounded: this runs *because* the wait above already failed, so
          // the page it interrogates is exactly the kind that may not
          // answer. evaluate() has no timeout of its own, and an unbounded
          // one here would eat the test budget and destroy the very error
          // it exists to enrich. Fall back to a null probe instead.
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
