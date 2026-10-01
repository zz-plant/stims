/**
 * A preset switch never shows black that neither preset drew.
 *
 * Every switch used to fade in from black, for three independent reasons:
 *
 *   - WebGL: outside a blend the composite draws straight to the canvas, so
 *     the display target the crossfade snapshot copied was empty or stale.
 *   - WebGPU: the present pass's `savedTex` compiled into the same binding as
 *     `currentTex` (three.js shares one binding between texture nodes that
 *     hold the same texture at compile time), so the dissolve never showed
 *     the snapshot at all.
 *   - Both: adaptive quality resizes the feedback targets on a switch, and
 *     three.js discards a target's contents when its size changes — the
 *     feedback history and the snapshot alike.
 *
 * This drives the production feedback managers directly in a real browser
 * (see feedback-continuity-harness.ts), so it pins the pictures themselves,
 * with no app shell, frame loop or blend gate in the way. The outgoing
 * "preset" draws a bright quad in the top-left quadrant and the incoming one
 * draws it in the bottom-right, so the live frame visibly diverges from the
 * outgoing picture from its first frame.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly, withDeadline } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import type {
  FeedbackHarnessBackend,
  QuadrantLuminance,
} from './feedback-continuity-harness.ts';
import { HEADLESS_ENVIRONMENT } from './headless-environment.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5189;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
/** Any same-origin document will do: the harness is imported into it. */
const HOST_PAGE = `${SERVER_URL}/robots.txt`;

let devServer: DevServerHandle | null = null;

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

type ScenarioArgs = {
  harnessModule: string;
  backend: FeedbackHarnessBackend;
  /** Frames for the feedback loop to settle before a switch. */
  warmupFrames: number;
  /** A quality step down, as adaptive quality applies on a switch. */
  switchResolution: number;
};

type HarnessModule = typeof import('./feedback-continuity-harness.ts');

/**
 * Runs `scenario` in a fresh page. It is serialised into the page, so it can
 * use nothing but its argument.
 */
async function runScenario<T>(
  backend: FeedbackHarnessBackend,
  scenario: (args: ScenarioArgs) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args:
      backend === 'webgpu'
        ? // Playwright's Chromium 153 Tint rejects the default composite
          // pipeline ("swizzle view instruction still has usages after
          // lowering") unless unsafe WebGPU is on; Chrome 152 compiles it.
          // That is its own bug — this suite is about what the targets hold.
          [...WEBGL_RENDERER_ARGS, '--enable-unsafe-webgpu']
        : WEBGL_RENDERER_ARGS,
  });
  try {
    const page = await browser.newPage();
    await page.goto(HOST_PAGE, { waitUntil: 'domcontentloaded' });
    return await withDeadline(
      page.evaluate(scenario, {
        harnessModule: '/tests/e2e/feedback-continuity-harness.ts',
        backend,
        warmupFrames: 30,
        switchResolution: 0.78,
      }),
      60000,
      `running the ${backend} feedback scenario`,
    );
  } finally {
    await closeQuietly(browser);
  }
}

function expectSamePicture(
  label: string,
  actual: QuadrantLuminance,
  expected: QuadrantLuminance,
  tolerance: number,
) {
  const fmt = (q: QuadrantLuminance) => q.map((v) => v.toFixed(1)).join(', ');
  // Two black frames match trivially; a harness that drew nothing (a failed
  // pipeline, a lost context) must not read as a pass.
  if (expected[0] < 100) {
    throw new Error(
      `${label}: the reference frame [${fmt(expected)}] is too dark to compare ` +
        '— the bright quadrant was never drawn.',
    );
  }
  const worst = Math.max(...actual.map((v, i) => Math.abs(v - expected[i])));
  if (worst > tolerance) {
    throw new Error(
      `${label}: quadrant luminance [${fmt(actual)}] differs from ` +
        `[${fmt(expected)}] by ${worst.toFixed(1)} (tolerance ${tolerance})`,
    );
  }
}

const BACKENDS: ReadonlyArray<{
  backend: FeedbackHarnessBackend;
  run: typeof requiredBrowserTest;
}> = [
  { backend: 'webgl', run: requiredBrowserTest },
  // Native WebGPU needs a real adapter; CI and cloud containers render
  // through SwiftShader, which has none.
  {
    backend: 'webgpu',
    run: hasChromium ? test.skipIf(HEADLESS_ENVIRONMENT) : test.skip,
  },
];

for (const { backend, run } of BACKENDS) {
  describe(`feedback continuity across a preset switch (${backend})`, () => {
    run(
      'a crossfade opens on the frame that was on screen',
      async () => {
        const { before, first, live } = await runScenario(
          backend,
          async ({ harnessModule, backend, warmupFrames }) => {
            const { createFeedbackHarness } = (await import(
              harnessModule
            )) as HarnessModule;
            const harness = await createFeedbackHarness(backend);
            const twin = await createFeedbackHarness(backend);
            try {
              for (let i = 0; i < warmupFrames; i += 1) {
                await harness.renderFrame();
                await twin.renderFrame();
              }
              const before = await harness.renderFrame();
              await twin.renderFrame();
              harness.saveCurrentFrame();
              harness.setTransitionBlend(1);
              harness.setScene('incoming');
              twin.setScene('incoming');
              return {
                before,
                first: await harness.renderFrame(),
                // What the screen shows with no snapshot over it.
                live: await twin.renderFrame(),
              };
            } finally {
              harness.dispose();
              twin.dispose();
            }
          },
        );
        // Only discriminating if the incoming frame looks different: its
        // quad lands in the bottom-right, where the outgoing frame is dark.
        expect(live[3] - before[3]).toBeGreaterThan(100);
        expectSamePicture('first blended frame', first, before, 2);
      },
      { timeout: 120000 },
    );

    run(
      'a quality-step resize at the switch keeps the outgoing frame',
      async () => {
        const { before, first } = await runScenario(
          backend,
          async ({
            harnessModule,
            backend,
            warmupFrames,
            switchResolution,
          }) => {
            const { createFeedbackHarness } = (await import(
              harnessModule
            )) as HarnessModule;
            const harness = await createFeedbackHarness(backend);
            try {
              for (let i = 0; i < warmupFrames; i += 1)
                await harness.renderFrame();
              const before = await harness.renderFrame();
              // The runtime's order: snapshot, then the adaptive-quality
              // pre-degrade resizes the targets, then the blend starts.
              harness.saveCurrentFrame();
              harness.setFeedbackResolution(switchResolution);
              harness.setTransitionBlend(1);
              harness.setScene('incoming');
              return { before, first: await harness.renderFrame() };
            } finally {
              harness.dispose();
            }
          },
        );
        expectSamePicture('first blended frame after resize', first, before, 3);
      },
      { timeout: 120000 },
    );

    run(
      'the feedback history survives a resolution change',
      async () => {
        const { resized, control } = await runScenario(
          backend,
          async ({
            harnessModule,
            backend,
            warmupFrames,
            switchResolution,
          }) => {
            const { createFeedbackHarness } = (await import(
              harnessModule
            )) as HarnessModule;
            const resizedHarness = await createFeedbackHarness(backend);
            const controlHarness = await createFeedbackHarness(backend);
            try {
              for (let i = 0; i < warmupFrames; i += 1) {
                await resizedHarness.renderFrame();
                await controlHarness.renderFrame();
              }
              // Nothing new is drawn from here on: whatever is on screen
              // afterwards is the history, carried forward.
              resizedHarness.setScene('empty');
              controlHarness.setScene('empty');
              // Down a quality step and back up, as adaptive quality does
              // across a switch, with no frame in between: a frame rendered
              // at the lower resolution diffuses differently (the blur steps
              // in texels), which would compare dynamics, not the carry.
              resizedHarness.setFeedbackResolution(switchResolution);
              resizedHarness.setFeedbackResolution(1);
              return {
                resized: await resizedHarness.renderFrame(),
                control: await controlHarness.renderFrame(),
              };
            } finally {
              resizedHarness.dispose();
              controlHarness.dispose();
            }
          },
        );
        expectSamePicture('history after two resizes', resized, control, 4);
      },
      { timeout: 120000 },
    );

    run(
      'a gated frame mid-blend does not replace the outgoing frame',
      async () => {
        const { before, resumed } = await runScenario(
          backend,
          async ({ harnessModule, backend, warmupFrames }) => {
            const { createFeedbackHarness } = (await import(
              harnessModule
            )) as HarnessModule;
            const harness = await createFeedbackHarness(backend);
            try {
              for (let i = 0; i < warmupFrames; i += 1)
                await harness.renderFrame();
              const before = await harness.renderFrame();
              harness.saveCurrentFrame();
              harness.setTransitionBlend(1);
              harness.setScene('incoming');
              await harness.renderFrame();
              // A workload or quality gate suspends the cover for a frame:
              // the transition controller hands the renderer alpha 0.
              harness.setTransitionBlend(0);
              await harness.renderFrame();
              harness.setTransitionBlend(1);
              return { before, resumed: await harness.renderFrame() };
            } finally {
              harness.dispose();
            }
          },
        );
        expectSamePicture(
          'blend resumed after a gated frame',
          resumed,
          before,
          2,
        );
      },
      { timeout: 120000 },
    );

    run(
      'a live crossfade shows the outgoing deck still moving',
      async () => {
        const frames = await runScenario(
          backend,
          async ({ harnessModule, backend, warmupFrames }) => {
            const { createFeedbackHarness } = (await import(
              harnessModule
            )) as HarnessModule;
            // The incoming deck presents; the outgoing deck renders offscreen
            // on the same renderer; the control presents the outgoing scene
            // on its own, which is what a live crossfade at alpha 1 must show.
            const incoming = await createFeedbackHarness(backend);
            const outgoing = incoming.addDeck();
            const control = await createFeedbackHarness(backend);
            try {
              incoming.setScene('incoming');
              incoming.setTransitionBlend(1);
              const pairs = [];
              for (let i = 0; i < warmupFrames; i += 1) {
                // The outgoing quad travels from the top-left quadrant into
                // the top-right one, so a frozen frame cannot pass.
                const x = -0.5 + (i / warmupFrames) * 1.0;
                outgoing.moveQuad(x, 0.5);
                control.moveQuad(x, 0.5);
                outgoing.renderOffscreen();
                incoming.setTransitionSource(outgoing);
                const screen = await incoming.renderFrame();
                const expected = await control.renderFrame();
                if (i % 10 === 9) pairs.push({ screen, expected });
              }
              return pairs;
            } finally {
              incoming.dispose();
              control.dispose();
            }
          },
        );
        // The outgoing picture really moved across the scenario.
        expect(frames.at(-1)?.expected[1] ?? 0).toBeGreaterThan(
          (frames[0]?.expected[1] ?? 0) + 50,
        );
        for (const [index, { screen, expected }] of frames.entries()) {
          expectSamePicture(`live frame ${index}`, screen, expected, 2);
        }
      },
      { timeout: 120000 },
    );

    run(
      "an incoming deck starts from the outgoing deck's picture",
      async () => {
        const { seeded, expected } = await runScenario(
          backend,
          async ({ harnessModule, backend, warmupFrames }) => {
            const { createFeedbackHarness } = (await import(
              harnessModule
            )) as HarnessModule;
            const incoming = await createFeedbackHarness(backend);
            const outgoing = incoming.addDeck();
            // One deck that never switches: the picture a seeded deck must
            // carry on from.
            const control = await createFeedbackHarness(backend);
            try {
              for (let i = 0; i < warmupFrames; i += 1) {
                outgoing.renderOffscreen();
                await control.renderFrame();
              }
              incoming.seedHistoryFrom(outgoing);
              incoming.setScene('empty');
              control.setScene('empty');
              return {
                seeded: await incoming.renderFrame(),
                expected: await control.renderFrame(),
              };
            } finally {
              incoming.dispose();
              control.dispose();
            }
          },
        );
        expectSamePicture('first frame of a seeded deck', seeded, expected, 3);
      },
      { timeout: 120000 },
    );

    run(
      'a switch made mid-blend dissolves out of the half-finished blend',
      async () => {
        const { midBlend, first } = await runScenario(
          backend,
          async ({ harnessModule, backend, warmupFrames }) => {
            const { createFeedbackHarness } = (await import(
              harnessModule
            )) as HarnessModule;
            const harness = await createFeedbackHarness(backend);
            try {
              for (let i = 0; i < warmupFrames; i += 1)
                await harness.renderFrame();
              harness.saveCurrentFrame();
              harness.setTransitionBlend(1);
              harness.setScene('incoming');
              await harness.renderFrame();
              harness.setTransitionBlend(0.5);
              const midBlend = await harness.renderFrame();
              // Another switch lands while the first is half done.
              harness.saveCurrentFrame();
              harness.setTransitionBlend(1);
              return { midBlend, first: await harness.renderFrame() };
            } finally {
              harness.dispose();
            }
          },
        );
        expectSamePicture('frame after a mid-blend switch', first, midBlend, 2);
      },
      { timeout: 120000 },
    );
  });
}
