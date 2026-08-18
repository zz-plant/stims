/**
 * E2E: Verify the engine mounts and renders on the WebGPU backend.
 *
 * Local-only. CI runs on SwiftShader, which has no WebGPU at all — there this
 * suite would only ever skip, and the WebGL sibling (e2e-engine-mount) already
 * covers that path. Locally the app auto-selects WebGPU on a real GPU, which
 * the WebGL suite deliberately pins away from (?renderer=webgl), so without
 * this file the backend users actually get on desktop had zero e2e coverage.
 *
 * The WebGL suite's pixel probes (drawImage into a scratch 2D canvas,
 * toDataURL) cannot work here: WebGPU does not retain presented frames the
 * way WebGL's preserveDrawingBuffer does, so every readback sees transparent
 * black forever. Instead this test reads the agent-mode runtime debug handle
 * (window.__milkdropRuntimeDebug, registered when ?agent=true): its
 * getPerformance().sampleCount increments once per engine frame that
 * completed the render path without throwing, which is a direct "frames are
 * being produced" signal that needs no access to the canvas at all.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { captureAgentStats, writeAgentFailureArtifact } from './agent-api.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import {
  HEADLESS,
  WEBGL_RENDERER_ARGS as RENDERER_ARGS,
} from './webgl-launch.ts';

const hasChromium = fs.existsSync(chromium.executablePath());

/** Skip without Playwright browsers (matches the other e2e suites) or on CI. */
const localWebGpuTest = hasChromium ? test.skipIf(!!process.env.CI) : test.skip;

const TEST_PORT = 5185;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
let devServer: DevServerHandle | null = null;

const PRESET_ID = 'eos-glowsticks-v2-03-music';

/**
 * How many engine frames must land after the preset is active. High enough
 * that a renderer stuck re-presenting one stale frame, or a loop that ticked
 * a couple of times before wedging, cannot pass; at 60fps it is under two
 * seconds of rendering.
 */
const REQUIRED_FRAME_ADVANCE = 60;

/** Shape of the agent-mode debug handle this test reads (see debug-snapshot.ts). */
type RuntimeDebugWindow = typeof window & {
  __milkdropRuntimeDebug?: {
    getState: () => { activePresetId: string; backend: 'webgl' | 'webgpu' };
    getPerformance: () => { sampleCount: number } | null;
  };
};

beforeAll(
  async () => {
    if (!hasChromium || process.env.CI) return;
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
  'mounts engine on WebGPU and produces frames',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: RENDERER_ARGS,
    });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      console.log(`[TEST BROWSER CONSOLE webgpu] ${msg.type()}: ${msg.text()}`);
    });

    try {
      // agent=true registers __milkdropRuntimeDebug; renderer=webgpu forces
      // backend selection past the auto heuristics.
      await page.goto(
        `${SERVER_URL}/?preset=${PRESET_ID}&audio=none&agent=true&renderer=webgpu`,
        { waitUntil: 'domcontentloaded' },
      );

      // WebGPU is a hardware capability, not a code path this repo controls:
      // Playwright's Chromium exposes no adapter on some local setups (old
      // GPUs, some Linux drivers). Bail out loudly rather than fail — a
      // missing adapter is this machine's limitation, not a Stims regression.
      // Probed here, not before goto: Chromium only exposes navigator.gpu on
      // real secure-context pages, so an about:blank probe always reads false.
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
          '[webgpu-engine-mount] No WebGPU adapter in this Chromium; ' +
            'skipping WebGPU e2e assertions on this machine.',
        );
        return;
      }

      await page.waitForSelector('#stims-main', { timeout: 30000 });
      await page.waitForFunction(
        () =>
          document.querySelector('#stims-main[data-active-preset-id]') !==
            null &&
          document.querySelector('.stims-shell__stage-frame canvas') !== null,
        undefined,
        { timeout: 60000 },
      );
      await page.waitForSelector(
        `.stims-shell__stage-frame[data-active-preset-id="${PRESET_ID}"]`,
        { state: 'attached', timeout: 60000 },
      );

      // The runtime registers the debug handle at engine mount.
      await page.waitForFunction(
        () =>
          (window as RuntimeDebugWindow).__milkdropRuntimeDebug !== undefined,
        undefined,
        { timeout: 30000 },
      );

      // The engine must actually be running WebGPU. If descriptor fallback
      // (backend-fallback.ts) kicked in, the page reloads into WebGL and this
      // reads 'webgl' — for this known-good preset that is a regression, not
      // an acceptable degrade.
      const backend = await page.evaluate(
        () =>
          (window as RuntimeDebugWindow).__milkdropRuntimeDebug?.getState()
            .backend,
      );
      expect(backend).toBe('webgpu');

      // Frames must advance from wherever the counter is now. sampleCount is
      // recorded by the frame loop only after the full simulate+render path
      // completed without throwing, so a wedged or crashing WebGPU renderer
      // stalls it even while the page's rAF keeps ticking.
      const baseline = await page.evaluate(
        () =>
          (
            window as RuntimeDebugWindow
          ).__milkdropRuntimeDebug?.getPerformance()?.sampleCount ?? 0,
      );
      await page.waitForFunction(
        ({ baseline, required }) => {
          const perf = (
            window as RuntimeDebugWindow
          ).__milkdropRuntimeDebug?.getPerformance();
          return (perf?.sampleCount ?? 0) >= baseline + required;
        },
        { baseline, required: REQUIRED_FRAME_ADVANCE },
        { timeout: 30000, polling: 250 },
      );

      // The backend must not have flipped while we were counting frames —
      // catches a mid-run fallback reload that restarted the counter on WebGL.
      const finalState = await page.evaluate(() => {
        const debug = (window as RuntimeDebugWindow).__milkdropRuntimeDebug;
        return debug
          ? {
              backend: debug.getState().backend,
              activePresetId: debug.getState().activePresetId,
            }
          : null;
      });
      expect(finalState).not.toBeNull();
      expect(finalState?.backend).toBe('webgpu');
      expect(finalState?.activePresetId).toBe(PRESET_ID);

      // Supplementary cross-check against the agent API's pixel-stats
      // readback. The sampleCount assertions above are the real correctness
      // signal (they need no canvas readback at all, which is the whole
      // reason this suite exists instead of reusing the WebGL suite's
      // pixel probes). This is additive only: log what captureStats() sees
      // across two captures ~300ms apart, but never fail the test on it —
      // a static-looking frame pair can legitimately read motionEstimate
      // 0, and this is a fragile GPU suite that shouldn't gain a second way
      // to flake.
      try {
        const statsA = await captureAgentStats(page);
        await page.waitForTimeout(300);
        const statsB = await captureAgentStats(page);
        console.log(
          '[webgpu-engine-mount] captureAgentStats cross-check:',
          JSON.stringify({
            motionEstimateA: statsA?.motionEstimate ?? null,
            motionEstimateB: statsB?.motionEstimate ?? null,
            edgeDensityB: statsB?.edgeDensity ?? null,
          }),
        );
        if (statsB && !(statsB.motionEstimate >= 0)) {
          console.warn(
            '[webgpu-engine-mount] captureAgentStats reported a non-numeric ' +
              'motionEstimate; supplementary signal only, not failing the test.',
          );
        }
      } catch (statsError) {
        // Supplementary signal only — never let a captureStats hiccup fail
        // this test when the primary sampleCount assertions already passed.
        console.warn(
          '[webgpu-engine-mount] captureAgentStats cross-check threw (non-fatal):',
          statsError,
        );
      }
    } catch (error) {
      await writeAgentFailureArtifact(
        page,
        'webgpu-engine-mount-mounts-engine-on-webgpu-and-produces-frames',
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
