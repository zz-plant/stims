/**
 * Boot-smoke gate: the app mounts, reaches a live audio-reactive state, and
 * produces animated pixels — per backend. Kept deliberately narrow (~20s)
 * and cheap so it can gate every commit, catching the entire class of
 * "doesn't boot / canvas is black / silent exception" regressions that a
 * targeted feature test would never think to check.
 *
 * Written the same day window.__stims_agent shipped, after that API's own
 * boot path broke silently in the working tree (a concurrent session's
 * in-flight WebGPU shader edit threw on mount) with nothing automated to
 * notice — this test is that net. It uses __stims_agent itself: waitFor
 * readiness instead of polling private DOM state, run() to start audio, and
 * captureStats()/getEvents() to assert the canvas is actually animating and
 * nothing threw, all through the same API documented in
 * docs/agents/browser-automation.md.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium } from 'playwright';
import {
  hasChromium,
  localOnlyBrowserTest,
  requiredBrowserTest,
} from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import {
  HEADLESS,
  SOFTWARE_RENDERER_ARGS,
  WEBGL_RENDERER_ARGS,
} from './webgl-launch.ts';

const browserTest = requiredBrowserTest;
/** WebGPU is a hardware capability CI's SwiftShader runner does not have —
 * matches webgpu-engine-mount.test.ts's own skip policy. */
const localWebGpuTest = localOnlyBrowserTest;

const TEST_PORT = 5186;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
let devServer: DevServerHandle | null = null;

/** Shape of window.__stims_agent; kept minimal to what this test reads. */
type AgentWindow = typeof window & {
  // Registered alongside __stims_agent when ?agent=true. Kept as a
  // supplementary signal now that captureStats reads inside a frame callback
  // and so works on WebGPU too.
  __milkdropRuntimeDebug?: {
    getPerformance: () => { sampleCount: number } | null;
  };
  __stims_agent?: {
    getState: () => {
      engineState: 'booting' | 'ready' | 'live';
      backend: string | null;
      lastError: string | null;
    };
    waitFor: (
      predicate: (state: {
        engineState: 'booting' | 'ready' | 'live';
        backend: string | null;
      }) => boolean,
      timeoutMs?: number,
    ) => Promise<unknown>;
    run: (
      actionId: string,
      params?: Record<string, unknown>,
    ) => Promise<{ ok: boolean; settled?: boolean; error?: string }>;
    getEvents: (
      sinceSeq?: number,
    ) => Array<{ seq: number; type: string; data: Record<string, unknown> }>;
    captureStats: () => Promise<{
      histogram: number[];
      edgeDensity: number;
      motionEstimate: number;
    } | null>;
  };
};

beforeAll(
  async () => {
    if (!hasChromium) return;
    devServer = await startDevServer({ port: TEST_PORT });
  },
  { timeout: 60000 },
);

afterAll(async () => {
  const server = devServer;
  devServer = null;
  await server?.stop();
});

/** Chromium's console text for a request that never completed. */
const RESOURCE_LOAD_ERROR = 'Failed to load resource';

/**
 * Drops up to `offOriginFailures` resource-load console errors, leaving every
 * other console error — and any same-origin resource failure — intact.
 *
 * The smoke test asserts a clean console to catch app errors. It must not also
 * assert that the machine running it has egress to every CDN the page
 * references: in a cloud agent container the Google Fonts stylesheet is reset
 * at the proxy, which is a fact about the sandbox, not a regression.
 */
export function discountOffOriginResourceErrors(
  consoleErrors: readonly string[],
  offOriginFailures: number,
): string[] {
  let remaining = offOriginFailures;
  return consoleErrors.filter((message) => {
    if (remaining > 0 && message.includes(RESOURCE_LOAD_ERROR)) {
      remaining -= 1;
      return false;
    }
    return true;
  });
}

async function runBootSmoke(renderer: 'webgl' | 'webgpu') {
  const browser = await chromium.launch({
    headless: HEADLESS,
    // WebGPU needs the real-GPU args (SwiftShader has no WebGPU adapter at
    // all); WebGL's own suite already runs software under CI for stability.
    args: renderer === 'webgpu' ? WEBGL_RENDERER_ARGS : SOFTWARE_RENDERER_ARGS,
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  // A blocked third-party request (the Google Fonts stylesheet, in a sandbox
  // with no egress to it) surfaces only as a generic "Failed to load resource"
  // console error with no URL, so the console alone cannot tell it from a
  // broken local asset. Record which off-origin requests actually failed, and
  // discount exactly that many resource errors below. A failed same-origin
  // request stays a failure.
  let offOriginRequestFailures = 0;
  page.on('requestfailed', (request) => {
    if (!request.url().startsWith(SERVER_URL)) offOriginRequestFailures += 1;
  });

  try {
    if (renderer === 'webgpu') {
      // Same adapter probe as webgpu-engine-mount.test.ts: a missing
      // adapter is this machine's limitation, not a Stims regression.
      await page.goto(`${SERVER_URL}/?renderer=webgpu`, {
        waitUntil: 'domcontentloaded',
      });
      const hasAdapter = await page.evaluate(async () => {
        if (!navigator.gpu) return false;
        try {
          return (await navigator.gpu.requestAdapter()) !== null;
        } catch {
          return false;
        }
      });
      if (!hasAdapter) {
        console.warn(
          '[agent-boot-smoke] No WebGPU adapter in this Chromium; skipping.',
        );
        return;
      }
    }

    await page.goto(`${SERVER_URL}/?agent=true&renderer=${renderer}`, {
      waitUntil: 'domcontentloaded',
    });

    // Readiness via the selector-waitable body attribute — no private DOM
    // state, no polling loop, no timeout tuned to a guessed boot budget.
    await page.waitForSelector('body[data-engine-state="ready"]', {
      timeout: 30000,
    });
    await page.waitForFunction(
      () => (window as AgentWindow).__stims_agent !== undefined,
      undefined,
      { timeout: 5000 },
    );

    const startResult = await page.evaluate(() =>
      (window as AgentWindow).__stims_agent?.run('audio-demo'),
    );
    expect(startResult?.ok).toBe(true);

    await page.waitForSelector('body[data-engine-state="live"]', {
      timeout: 15000,
    });

    if (renderer === 'webgpu') {
      await page.evaluate(() =>
        (window as AgentWindow).__stims_agent?.waitFor(
          (state) => state.backend === 'webgpu',
          10000,
        ),
      );
      const backend = await page.evaluate(
        () => (window as AgentWindow).__stims_agent?.getState().backend,
      );
      // A silent descriptor fallback to WebGL is a real regression for this
      // check's purpose — it means the WebGPU boot path never actually ran.
      expect(backend).toBe('webgpu');
    }

    // Confirm the canvas is actually animating, not just present. Poll
    // captureStats a few times with real gaps rather than trusting one
    // 400ms window — some presets/moments have near-static motion over
    // any single short interval, but genuine animation shows a delta
    // somewhere across a handful of samples. On-demand calls only (per
    // its own contract): never per-frame.
    //
    // Both backends take this path. WebGPU used to be exempted because the
    // readback always saw transparent black; it reads inside a frame
    // callback now, so the default backend gets the same pixel-level
    // assertion instead of a proxy frame counter.
    let observedMotion = 0;
    for (let i = 0; i < 5; i += 1) {
      await page.waitForTimeout(400);
      const stats = await page.evaluate(
        async () =>
          (await (window as AgentWindow).__stims_agent?.captureStats()) ?? null,
      );
      expect(stats).not.toBeNull();
      observedMotion = Math.max(observedMotion, stats?.motionEstimate ?? 0);
      if (observedMotion > 0) break;
    }
    expect(observedMotion).toBeGreaterThan(0);

    // No error events on the agent's own log, and no console errors either
    // — the two catch different failure shapes (thrown-and-caught vs.
    // thrown-to-console).
    const errorEvents = await page.evaluate(() =>
      (window as AgentWindow).__stims_agent
        ?.getEvents()
        .filter((e) => e.type === 'error'),
    );
    expect(errorEvents ?? []).toEqual([]);
    const appConsoleErrors = discountOffOriginResourceErrors(
      consoleErrors,
      offOriginRequestFailures,
    );
    expect(appConsoleErrors).toEqual([]);

    const lastError = await page.evaluate(
      () => (window as AgentWindow).__stims_agent?.getState().lastError,
    );
    expect(lastError).toBeNull();
  } catch (error) {
    console.error(
      `[agent-boot-smoke:${renderer}] console errors seen: ${JSON.stringify(consoleErrors)} (${offOriginRequestFailures} off-origin request failure(s) discounted)`,
    );
    throw error;
  } finally {
    await closeQuietly(ctx, browser);
  }
}

browserTest(
  'boots, starts audio, and renders animated frames on WebGL',
  () => runBootSmoke('webgl'),
  { timeout: 90000 },
);

localWebGpuTest(
  'boots, starts audio, and renders animated frames on WebGPU',
  () => runBootSmoke('webgpu'),
  { timeout: 90000 },
);
