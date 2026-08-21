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
  // Registered alongside __stims_agent when ?agent=true; used only for the
  // WebGPU path below, where a pixel readback (captureStats) always sees
  // transparent black — WebGPU does not retain presented frames the way
  // WebGL's preserveDrawingBuffer does (see webgpu-engine-mount.test.ts).
  __milkdropRuntimeDebug?: {
    getPerformance: () => { sampleCount: number } | null;
  };
  __stims_agent?: {
    getState: () => {
      engineState: 'booting' | 'ready' | 'live';
      backend: string | null;
      lastError: string | null;
    };
    waitFor: (predicateSource: string, timeoutMs?: number) => Promise<unknown>;
    run: (
      actionId: string,
      params?: Record<string, unknown>,
    ) => Promise<{ ok: boolean; settled?: boolean; error?: string }>;
    getEvents: (
      sinceSeq?: number,
    ) => Array<{ seq: number; type: string; data: Record<string, unknown> }>;
    captureStats: () => {
      histogram: number[];
      edgeDensity: number;
      motionEstimate: number;
    } | null;
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
      const backend = await page.evaluate(
        () => (window as AgentWindow).__stims_agent?.getState().backend,
      );
      // A silent descriptor fallback to WebGL is a real regression for this
      // check's purpose — it means the WebGPU boot path never actually ran.
      expect(backend).toBe('webgpu');
    }

    if (renderer === 'webgpu') {
      // captureStats' pixel readback cannot see a WebGPU canvas (see the
      // type comment above), so use the same real-frames signal the deep
      // WebGPU suite does — just a much smaller bar, since this is a smoke
      // check, not exhaustive coverage.
      await page.waitForFunction(
        () => (window as AgentWindow).__milkdropRuntimeDebug !== undefined,
        undefined,
        { timeout: 10000 },
      );
      const baseline = await page.evaluate(
        () =>
          (window as AgentWindow).__milkdropRuntimeDebug?.getPerformance()
            ?.sampleCount ?? 0,
      );
      await page.waitForFunction(
        (base) =>
          ((window as AgentWindow).__milkdropRuntimeDebug?.getPerformance()
            ?.sampleCount ?? 0) >=
          base + 10,
        baseline,
        { timeout: 15000, polling: 250 },
      );
    } else {
      // Confirm the canvas is actually animating, not just present. Poll
      // captureStats a few times with real gaps rather than trusting one
      // 400ms window — some presets/moments have near-static motion over
      // any single short interval, but genuine animation shows a delta
      // somewhere across a handful of samples. On-demand calls only (per
      // its own contract): never per-frame.
      let observedMotion = 0;
      for (let i = 0; i < 5; i += 1) {
        await page.waitForTimeout(400);
        const stats = await page.evaluate(
          () => (window as AgentWindow).__stims_agent?.captureStats() ?? null,
        );
        expect(stats).not.toBeNull();
        observedMotion = Math.max(observedMotion, stats?.motionEstimate ?? 0);
        if (observedMotion > 0) break;
      }
      expect(observedMotion).toBeGreaterThan(0);
    }

    // No error events on the agent's own log, and no console errors either
    // — the two catch different failure shapes (thrown-and-caught vs.
    // thrown-to-console).
    const errorEvents = await page.evaluate(() =>
      (window as AgentWindow).__stims_agent
        ?.getEvents()
        .filter((e) => e.type === 'error'),
    );
    expect(errorEvents ?? []).toEqual([]);
    expect(consoleErrors).toEqual([]);

    const lastError = await page.evaluate(
      () => (window as AgentWindow).__stims_agent?.getState().lastError,
    );
    expect(lastError).toBeNull();
  } catch (error) {
    console.error(
      `[agent-boot-smoke:${renderer}] console errors seen: ${JSON.stringify(consoleErrors)}`,
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
