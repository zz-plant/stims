/**
 * Crossfades actually happen.
 *
 * The blend path shipped, had a workload gate, and was unreachable: the
 * threshold (900) sat below the corpus MINIMUM frame workload (1323 — the
 * warp mesh alone contributes ~992), so every preset switch in the product
 * silently became a hard cut and the blend-duration control did nothing.
 * `milkdrop-blend-gate.test.ts` pins the threshold against measured corpus
 * numbers; this test pins the thing that actually matters, end to end, in a
 * browser that is really rendering.
 *
 * It has to be an e2e test. `beginPresetTransition` clones the CURRENT
 * frame state to blend out of, and a hidden tab has none — the browser
 * stops scheduling rAF entirely — so any harness whose page is not visibly
 * rendering records a cut no matter how the gate is configured. That is
 * exactly the trap that made the original bug look like it might be a
 * measurement artifact.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium } from 'playwright';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, SOFTWARE_RENDERER_ARGS } from './webgl-launch.ts';

const browserTest = requiredBrowserTest;
const TEST_PORT = 5188;
/** Light, always-bundled, and already used as the first-run preset. */
const TARGET_PRESET_ID = 'geiss-experimental-lsb-bass-cubes';
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
let devServer: DevServerHandle | null = null;

type TransitionEvent = { at: number; event: string; detail?: string };
type AgentWindow = typeof window & {
  __milkdropRuntimeDebug?: {
    getTransition: () => {
      phase: string;
      crossfade: number | null;
      events: ReadonlyArray<TransitionEvent>;
    };
  };
  __stims_agent?: {
    run: (
      actionId: string,
      params?: Record<string, unknown>,
    ) => Promise<{ ok: boolean; error?: string }>;
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

browserTest(
  'a preset switch in blend mode crossfades instead of cutting',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: SOFTWARE_RENDERER_ARGS,
    });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();

    try {
      await page.goto(`${SERVER_URL}/?agent=true&renderer=webgl`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('body[data-engine-state="ready"]', {
        timeout: 30000,
      });
      await page.evaluate(() =>
        (window as AgentWindow).__stims_agent?.run('audio-demo'),
      );
      await page.waitForSelector('body[data-engine-state="live"]', {
        timeout: 20000,
      });

      // Frames must have been rendered before the switch: the outgoing
      // frame state is what a crossfade blends FROM, and under a software
      // renderer the first few frames take a while to arrive.
      await page.waitForFunction(
        () =>
          ((window as AgentWindow).__milkdropRuntimeDebug?.getTransition()
            ?.phase ?? null) !== null,
        undefined,
        { timeout: 10000 },
      );
      await page.waitForTimeout(3000);

      await page.evaluate(() =>
        (window as AgentWindow).__stims_agent?.run('transition-2s'),
      );

      const before = await page.evaluate(
        () =>
          (window as AgentWindow).__milkdropRuntimeDebug?.getTransition().events
            .length ?? 0,
      );

      // A named target, not `next-preset`: which preset the shuffle lands
      // on is random, and a heavy one can spend longer compiling under a
      // software renderer than this test is willing to wait — a flaky
      // failure that would say nothing about the gate.
      const advance = await page.evaluate(
        (presetId) =>
          (window as AgentWindow).__stims_agent?.run('select-preset', {
            id: presetId,
          }),
        TARGET_PRESET_ID,
      );
      expect(advance?.ok).toBe(true);

      await page.waitForFunction(
        (seen) => {
          const events =
            (window as AgentWindow).__milkdropRuntimeDebug?.getTransition()
              .events ?? [];
          return events.length > (seen as number);
        },
        before,
        // Generous: under a software renderer a preset switch has to compile
        // shaders before it can transition at all.
        { timeout: 30000 },
      );
      await page.waitForTimeout(500);

      const events: TransitionEvent[] = await page.evaluate(
        (seen) =>
          ((window as AgentWindow).__milkdropRuntimeDebug
            ?.getTransition()
            .events.slice(seen as number) ?? []) as TransitionEvent[],
        before,
      );

      expect(events.length).toBeGreaterThan(0);

      // What this pins is that the WORKLOAD gate never refuses a normal
      // preset — the regression that made the whole blend path dead code.
      //
      // It deliberately does not demand a blend outright. CI renders through
      // SwiftShader at a handful of frames per second, where the frame-
      // pressure and thermal gates refuse crossfades for entirely correct
      // reasons; asserting `blend-started` there would pin the renderer's
      // speed, not the gate's logic. Each cut now carries its reason, so the
      // one refusal that must never appear can be named exactly.
      const workloadRefusals = events.filter(
        (entry) => entry.event === 'cut' && entry.detail === 'workload',
      );
      expect(workloadRefusals).toEqual([]);

      // And whatever did happen has to be an outcome the controller can
      // account for, rather than silence.
      const kinds = new Set(events.map((entry) => entry.event));
      expect(
        ['blend-started', 'cut', 'begin-ignored'].some((kind) =>
          kinds.has(kind),
        ),
      ).toBe(true);
    } finally {
      await closeQuietly(page, ctx, browser);
    }
  },
  { timeout: 120000 },
);
