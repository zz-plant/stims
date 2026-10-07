/**
 * E2E: a phone held upright gets a lit stage from the first-run preset.
 *
 * Until 2026-10-06 the first-run preset settled to black on every portrait
 * phone on WebGPU (first-run-preset.ts says why). The evidence test in
 * tests/unit/bundled-first-run-preset.test.ts gates the choice on recorded
 * numbers; this suite walks the path a visitor takes instead: no deep link,
 * the attract preview, Play demo, then the settled picture.
 *
 * Local-only, like webgpu-engine-mount: CI renders on SwiftShader, which has
 * no WebGPU, and WebGL never showed the failure.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium } from 'playwright';
import {
  resolveLoopSweepChromiumArgs,
  SWEEP_CHROMIUM_CHANNEL,
} from '../../scripts/run-milkdrop-loop-visual-sweep.ts';
import { FIRST_RUN_PRESET_ID } from '../../src/js/milkdrop/runtime/first-run-preset.ts';
import {
  agentPredicates,
  captureAgentStats,
  waitForAgentState,
  writeAgentFailureArtifact,
} from './agent-api.ts';
import { hasChromium } from './browser-availability.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS_ENVIRONMENT } from './headless-environment.ts';

const localWebGpuTest = hasChromium
  ? test.skipIf(HEADLESS_ENVIRONMENT)
  : test.skip;

const TEST_PORT = 5190;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
let devServer: DevServerHandle | null = null;

/** iPhone 12-15 in CSS pixels, held upright. */
const PORTRAIT_VIEWPORT = { width: 390, height: 844 };

/**
 * Engine frames to let the feedback loop run after Play demo. The previous
 * default could still be partly lit in its opening seconds, so this samples
 * the settled picture. Counted in frames, not milliseconds, so a slow machine
 * waits longer instead of sampling earlier.
 */
const SETTLE_FRAMES = 1200;

/**
 * Share of the frame that must have at least one colour channel at 32/255 or
 * above. Measured at 390x844: the previous default read 0, 0, 0 and 0.36
 * (dim red) over four runs; the current one reads 0.88-0.92.
 */
const MIN_LIT_SHARE = 0.5;

type RuntimeDebugWindow = typeof window & {
  __milkdropRuntimeDebug?: {
    getPerformance: () => { sampleCount: number } | null;
  };
};

beforeAll(
  async () => {
    if (!hasChromium || HEADLESS_ENVIRONMENT) return;
    devServer = await startDevServer({ port: TEST_PORT });
  },
  { timeout: 60000 },
);

afterAll(async () => {
  const server = devServer;
  devServer = null;
  await server?.stop();
});

localWebGpuTest(
  'first run on a portrait phone settles into a lit stage on WebGPU',
  async () => {
    // The preset lab's launch: full Chromium in new headless mode. Default
    // headed Chromium reads every WebGPU frame back as transparent black, so
    // a landscape frame that is plainly lit scored 0 here.
    const browser = await chromium.launch({
      channel: SWEEP_CHROMIUM_CHANNEL,
      headless: true,
      args: resolveLoopSweepChromiumArgs('webgpu', true),
    });
    const ctx = await browser.newContext({
      viewport: PORTRAIT_VIEWPORT,
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();

    try {
      // No ?preset=: the first-run choice is the thing under test.
      await page.goto(`${SERVER_URL}/?agent=true`, {
        waitUntil: 'domcontentloaded',
      });

      const hasWebGpuAdapter = await page.evaluate(async () => {
        if (!navigator.gpu) return false;
        try {
          return (await navigator.gpu.requestAdapter()) !== null;
        } catch {
          return false;
        }
      });
      if (!hasWebGpuAdapter) {
        console.warn(
          '[first-run-portrait] No WebGPU adapter in this Chromium; ' +
            'skipping on this machine.',
        );
        return;
      }

      await page.click('.stims-shell__launch-cta', { timeout: 30000 });
      await waitForAgentState(
        page,
        (state) =>
          agentPredicates.engineLive()(state) &&
          agentPredicates.backendIs('webgpu')(state) &&
          agentPredicates.presetIs(FIRST_RUN_PRESET_ID)(state),
        60000,
      );

      const baseline = await page.evaluate(
        () =>
          (
            window as RuntimeDebugWindow
          ).__milkdropRuntimeDebug?.getPerformance()?.sampleCount ?? 0,
      );
      await page.waitForFunction(
        ({ baseline, required }) =>
          ((
            window as RuntimeDebugWindow
          ).__milkdropRuntimeDebug?.getPerformance()?.sampleCount ?? 0) >=
          baseline + required,
        { baseline, required: SETTLE_FRAMES },
        { timeout: 120000, polling: 500 },
      );

      const stats = await captureAgentStats(page);
      expect(stats).not.toBeNull();
      // histogram is 8 bins per channel (r, g, b); bin 0 is 0-31.
      const histogram = stats?.histogram ?? [];
      const litShare = Math.max(
        1 - (histogram[0] ?? 1),
        1 - (histogram[8] ?? 1),
        1 - (histogram[16] ?? 1),
      );
      expect(litShare).toBeGreaterThanOrEqual(MIN_LIT_SHARE);
    } catch (error) {
      await writeAgentFailureArtifact(
        page,
        'first-run-portrait-settles-into-a-lit-stage-on-webgpu',
      );
      throw error;
    } finally {
      try {
        await ctx.close();
      } catch {}
      try {
        await browser.close();
      } catch {}
    }
  },
  { timeout: 240000 },
);
