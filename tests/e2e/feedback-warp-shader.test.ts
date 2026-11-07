/**
 * What the feedback loop carries after a preset's own warp shader.
 *
 * MilkDrop applies fDecay in its default warp only: a preset with a warp
 * shader writes its own fade (`ret *= 0.97`, `ret -= 0.004`), and MilkDrop 2,
 * Butterchurn and native projectM 3.1.12 all leave the shader's output
 * undecayed. Geometry is then drawn onto that output with its own blend mode,
 * exactly as it is without a warp shader.
 *
 * Both went wrong together. The blend pass added the scene onto a warp
 * shader's output instead of drawing it over, so a translucent shape or
 * motion-vector dot brightened the frame without bound; fDecay was then
 * applied to warp-shader presets too, which hid the runaway at the cost of
 * dimming every one of them a second time each frame. martin-neon-space-ps3
 * (fDecay 0.5, grey motion vectors) rendered as a grey speckle field where
 * Butterchurn draws coloured star trails.
 *
 * Drives the production feedback managers through the in-page harness (see
 * feedback-continuity-harness.ts) with tiny compiled presets, so the frames
 * are the pass's own arithmetic and nothing else.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly, withDeadline } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import type { FeedbackHarnessBackend } from './feedback-continuity-harness.ts';
import { HEADLESS_ENVIRONMENT } from './headless-environment.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5193;
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

/**
 * A preset whose warp and comp shaders copy their input unchanged, so the
 * only thing that can change the carried picture is the blend pass itself.
 * Without the warp shader, the default warp carries the picture instead.
 */
function presetSource({
  decay,
  warpShader,
}: {
  decay: number;
  warpShader: boolean;
}) {
  return [
    '[preset00]',
    `fDecay=${decay}`,
    'fGammaAdj=1.0',
    'fVideoEchoAlpha=0',
    'fWaveAlpha=0',
    'zoom=1',
    'warp=0',
    ...(warpShader
      ? [
          'warp_1=`shader_body',
          'warp_2=`{',
          'warp_3=`ret = tex2D(sampler_main, uv).xyz;',
          'warp_4=`}',
        ]
      : []),
    'comp_1=`shader_body',
    'comp_2=`{',
    'comp_3=`ret = tex2D(sampler_main, uv).xyz;',
    'comp_4=`}',
    '',
  ].join('\n');
}

/**
 * A warp shader that declares a scalar under one of the control dialect's
 * names. MilkDrop has no `r` builtin: the body's `r` is its own per-pixel
 * variable, so the frame is a left-to-right ramp.
 */
const SCALAR_LOCAL_PRESET = [
  '[preset00]',
  'fDecay=1',
  'fGammaAdj=1.0',
  'fVideoEchoAlpha=0',
  'fWaveAlpha=0',
  'zoom=1',
  'warp=0',
  'warp_1=`shader_body',
  'warp_2=`{',
  'warp_3=`float r = uv.x;',
  'warp_4=`ret = float3(r, r, r);',
  'warp_5=`}',
  'comp_1=`shader_body',
  'comp_2=`{',
  'comp_3=`ret = tex2D(sampler_main, uv).xyz;',
  'comp_4=`}',
  '',
].join('\n');

type ScenarioArgs = {
  harnessModule: string;
  backend: FeedbackHarnessBackend;
  withWarpShader: string;
  withoutWarpShader: string;
  scalarLocal: string;
};

type HarnessModule = typeof import('./feedback-continuity-harness.ts');

/**
 * Runs `scenario` in a fresh page. It is serialised into the page, so it can
 * use nothing but its argument.
 */
async function runScenario<T>(
  backend: FeedbackHarnessBackend,
  decay: number,
  scenario: (args: ScenarioArgs) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args:
      backend === 'webgpu'
        ? [...WEBGL_RENDERER_ARGS, '--enable-unsafe-webgpu']
        : WEBGL_RENDERER_ARGS,
  });
  try {
    const page = await browser.newPage();
    await page.goto(HOST_PAGE, { waitUntil: 'domcontentloaded' });
    return await withDeadline(
      page.evaluate(scenario, {
        harnessModule: '/tests/e2e/feedback-continuity-harness.ts',
        backend,
        withWarpShader: presetSource({ decay, warpShader: true }),
        withoutWarpShader: presetSource({ decay, warpShader: false }),
        scalarLocal: SCALAR_LOCAL_PRESET,
      }),
      60000,
      `running the ${backend} warp-shader scenario`,
    );
  } finally {
    await closeQuietly(browser);
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
  describe(`feedback after a preset warp shader (${backend})`, () => {
    run(
      'fDecay does not dim what a warp shader carries',
      async () => {
        const { carried, decayed } = await runScenario(
          backend,
          0.5,
          async ({
            harnessModule,
            backend,
            withWarpShader,
            withoutWarpShader,
          }) => {
            const { createFeedbackHarness } = (await import(
              harnessModule
            )) as HarnessModule;
            const run = async (presetSource: string) => {
              const harness = await createFeedbackHarness(backend);
              try {
                await harness.applyPreset(presetSource);
                for (let i = 0; i < 10; i += 1) await harness.renderFrame();
                // Nothing new is drawn from here on: what stays on screen is
                // whatever the feedback loop carries.
                harness.setScene('empty');
                let frame = await harness.renderFrame();
                for (let i = 0; i < 9; i += 1) {
                  frame = await harness.renderFrame();
                }
                return frame[0];
              } finally {
                harness.dispose();
              }
            };
            return {
              carried: await run(withWarpShader),
              decayed: await run(withoutWarpShader),
            };
          },
        );
        // The default warp does decay — ten frames at 0.5 leave 1/1024 —
        // so the warp-shader case is not passing because decay is unwired.
        expect(decayed).toBeLessThan(10);
        expect(carried).toBeGreaterThan(240);
      },
      { timeout: 120000 },
    );

    run(
      'translucent geometry goes over a warp shader the same as without one',
      async () => {
        const { overWarpShader, overDefaultWarp } = await runScenario(
          backend,
          1,
          async ({
            harnessModule,
            backend,
            withWarpShader,
            withoutWarpShader,
          }) => {
            const { createFeedbackHarness } = (await import(
              harnessModule
            )) as HarnessModule;
            const run = async (presetSource: string) => {
              const harness = await createFeedbackHarness(backend);
              try {
                await harness.applyPreset(presetSource);
                // A faint grey quad every frame. Drawn over the carried
                // picture it converges on its own colour; added onto it, it
                // saturates within ten frames.
                harness.setQuadStyle(0.5, 0.2);
                let frame = await harness.renderFrame();
                for (let i = 0; i < 59; i += 1) {
                  frame = await harness.renderFrame();
                }
                return frame[0];
              } finally {
                harness.dispose();
              }
            };
            return {
              overWarpShader: await run(withWarpShader),
              overDefaultWarp: await run(withoutWarpShader),
            };
          },
        );
        // The quad was drawn, and the default warp's over converged short of
        // white: the comparison below can tell over from add.
        expect(overDefaultWarp).toBeGreaterThan(60);
        expect(overDefaultWarp).toBeLessThan(220);
        expect(Math.abs(overWarpShader - overDefaultWarp)).toBeLessThan(6);
      },
      { timeout: 120000 },
    );

    run(
      'a scalar the warp shader declares stays its own variable',
      async () => {
        const quadrants = await runScenario(
          backend,
          1,
          async ({ harnessModule, backend, scalarLocal }) => {
            const { createFeedbackHarness } = (await import(
              harnessModule
            )) as HarnessModule;
            const harness = await createFeedbackHarness(backend);
            try {
              await harness.applyPreset(scalarLocal);
              harness.setScene('empty');
              let frame = await harness.renderFrame();
              for (let i = 0; i < 4; i += 1)
                frame = await harness.renderFrame();
              return frame;
            } finally {
              harness.dispose();
            }
          },
        );
        // `float r = uv.x` read as the colorScale.r control painted one flat
        // value across the frame: black while the control dialect evaluated
        // it at uv (0,0), white once that stand-in went neutral.
        const [topLeft, topRight] = quadrants;
        expect(topRight - topLeft).toBeGreaterThan(80);
      },
      { timeout: 120000 },
    );
  });
}

/**
 * A per-pixel warp without a warp shader, through the UV map. On
 * krash-rovastar-cerebral-demons-stars the scatter mesh put about 1% of its
 * vertices on screen, so most of the picture was never warped at all and a
 * first edit couldn't show. The harness steps the real VM against a moving
 * source quad, so two runs of one preset match exactly and a control edit
 * reads 0.
 */
describe('WebGL per-pixel warp through the UV map', () => {
  const measure = async (query: string) => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: WEBGL_RENDERER_ARGS,
    });
    try {
      const page = await browser.newPage();
      await page.goto(`${HOST_PAGE}${query}`, {
        waitUntil: 'domcontentloaded',
      });
      return await withDeadline(
        page.evaluate(async (harnessModule) => {
          const { createFeedbackHarness } = (await import(
            harnessModule
          )) as HarnessModule;
          const source = await (
            await fetch(
              '/milkdrop-presets/krash-rovastar-cerebral-demons-stars.milk',
            )
          ).text();
          const run = async (line: string) => {
            const edited = `${source}\n${line}\n`;
            const harness = await createFeedbackHarness('webgl');
            await harness.applyPreset(edited);
            const step = harness.fieldStepper(edited);
            let pixels = new Uint8Array(0);
            for (let frame = 0; frame < 60; frame += 1) {
              harness.setQuadStyle((((frame * 37) % 200) + 40) / 255, 1);
              harness.moveQuad(
                Math.sin(frame * 0.7) * 0.8,
                Math.cos(frame * 1.1) * 0.8,
              );
              pixels = await step();
            }
            return pixels;
          };
          const difference = (a: Uint8Array, b: Uint8Array) => {
            let sum = 0;
            for (let index = 0; index < a.length; index += 1) {
              if (index % 4 !== 3) {
                sum += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
              }
            }
            return sum / ((a.length / 4) * 3);
          };
          // The VM's per-preset constants draw from Math.random at load.
          const seeded = async (line: string) => {
            let state = 7;
            Math.random = () => {
              state = (state * 16807) % 2147483647;
              return state / 2147483647;
            };
            return run(line);
          };
          const original = await seeded('');
          let lit = 0;
          for (let index = 0; index < original.length; index += 4) {
            const brightness =
              (original[index] ?? 0) +
              (original[index + 1] ?? 0) +
              (original[index + 2] ?? 0);
            if (brightness > 6) lit += 1;
          }
          return {
            litShare: lit / (original.length / 4),
            control: difference(
              original,
              await seeded('per_pixel_900=rot=rot+0;'),
            ),
            edit: difference(
              original,
              await seeded('per_pixel_900=rot=rot+0.02;'),
            ),
          };
        }, '/tests/e2e/feedback-continuity-harness.ts'),
        120000,
        'measuring the UV map warp',
      );
    } finally {
      await closeQuietly(browser);
    }
  };

  requiredBrowserTest(
    'covers the whole picture, and a first edit reaches it',
    async () => {
      const { litShare, control, edit } = await measure('');
      expect(litShare).toBe(1);
      expect(edit).toBeGreaterThan(Math.max(control * 3, 0.5));
    },
    180000,
  );

  requiredBrowserTest(
    'the scatter mesh left uncovered, which is the bug this replaced',
    async () => {
      const { litShare } = await measure('?warpUvMap=0');
      expect(litShare).toBeLessThan(0.9);
    },
    180000,
  );
});
