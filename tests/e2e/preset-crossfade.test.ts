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
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS_ENVIRONMENT } from './headless-environment.ts';
import {
  HEADLESS,
  SOFTWARE_RENDERER_ARGS,
  WEBGL_RENDERER_ARGS,
} from './webgl-launch.ts';

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
      live: { presetId: string; frames: number } | null;
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
        (window as AgentWindow).__stims_agent?.run('transition-2.5s'),
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

/**
 * A live crossfade keeps the outgoing preset running — stepping its own VM,
 * rendering its own feedback deck — until the blend settles, then lets it go.
 *
 * Local-only: the live tier needs a frame with room to double, which
 * SwiftShader never has, so in CI every switch correctly blends out of a
 * snapshot instead. Even on a real GPU the gate may refuse a given switch
 * (a loaded machine reads as frame pressure), so this tries a few switches
 * and fails only if none of them goes live.
 */
const localGpuTest = hasChromium
  ? test.skipIf(HEADLESS_ENVIRONMENT)
  : test.skip;

localGpuTest(
  'a live crossfade keeps the outgoing preset running until it settles',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: WEBGL_RENDERER_ARGS,
    });
    const ctx = await browser.newContext({
      viewport: { width: 960, height: 540 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    const transition = () =>
      page.evaluate(
        () =>
          (window as AgentWindow).__milkdropRuntimeDebug?.getTransition() ??
          null,
      );

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
      await page.evaluate(() =>
        (window as AgentWindow).__stims_agent?.run('transition-2.5s'),
      );
      await page.waitForTimeout(3000);

      let liveEvents: string[] | null = null;
      const refusals: string[] = [];
      for (let attempt = 0; attempt < 4 && !liveEvents; attempt += 1) {
        const seen = (await transition())?.events.length ?? 0;
        await page.evaluate(() =>
          (window as AgentWindow).__stims_agent?.run('next-preset'),
        );
        // Until this switch's blend has either gone live or settled.
        await page.waitForFunction(
          (count) => {
            const t = (
              window as AgentWindow
            ).__milkdropRuntimeDebug?.getTransition();
            const events = t?.events.slice(count as number) ?? [];
            return events.some((e) =>
              ['live-blend-started', 'settled', 'cut'].includes(e.event),
            );
          },
          seen,
          { timeout: 30000 },
        );
        const started = await transition();
        if (!started?.live) {
          refusals.push(
            (started?.events.slice(seen) ?? [])
              .map((e) => `${e.event}${e.detail ? `(${e.detail})` : ''}`)
              .join(' '),
          );
          await page.waitForTimeout(3000);
          continue;
        }

        // The outgoing preset is still stepping mid-blend...
        const firstFrames = started.live.frames;
        await page.waitForTimeout(400);
        const later = await transition();
        expect(later?.live?.frames ?? 0).toBeGreaterThan(firstFrames);

        // ...and is let go once the blend settles.
        await page.waitForFunction(
          () =>
            (window as AgentWindow).__milkdropRuntimeDebug?.getTransition()
              .live === null,
          undefined,
          { timeout: 10000 },
        );
        liveEvents = ((await transition())?.events.slice(seen) ?? []).map(
          (e) => e.event,
        );
      }

      if (!liveEvents) {
        throw new Error(
          `No switch went live in 4 attempts; the gate said: ${refusals.join(' / ')}`,
        );
      }
      expect(liveEvents).toEqual(
        expect.arrayContaining([
          'blend-started',
          'live-blend-started',
          'settled',
          'live-blend-ended',
        ]),
      );
    } finally {
      await closeQuietly(page, ctx, browser);
    }
  },
  { timeout: 180000 },
);
