/**
 * E2E: the flash sampler's off-thread readback sees the frame on screen.
 *
 * The sampler snapshots the stage inside the draw and reads the snapshot
 * back in a worker, so the wait for the GPU leaves the render loop. A
 * snapshot taken at the wrong moment reads a cleared or stale buffer, and
 * the governor goes blind without an error; that is how it ran in
 * production until the reads moved into the draw. So each grid here is
 * checked against the main-thread read of the same frame, taken right after
 * the snapshot in the same task.
 *
 * Not in agent mode: agent mode preserves the drawing buffer, which hides
 * exactly the timing this test is about.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium } from 'playwright';
import {
  hasChromium,
  localOnlyBrowserTest,
  requiredBrowserTest,
} from './browser-availability.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5182;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
let devServer: DevServerHandle | null = null;

/** Grids compared per backend: enough frames that a lucky match cannot pass. */
const FRAMES = 8;

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
}, 30000);

type Comparison = {
  offThread: boolean;
  compared: number;
  maxDifference: number;
  meanLuminance: number;
};

async function compareReadbacks(
  renderer: 'webgl' | 'webgpu',
): Promise<Comparison> {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args:
      renderer === 'webgpu'
        ? [...WEBGL_RENDERER_ARGS, '--enable-unsafe-webgpu']
        : WEBGL_RENDERER_ARGS,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    await page.goto(
      // The first-run preset: bright on both backends, where glowsticks
      // averages near black on WebGPU and a 16x16 grid of it proves little.
      `${SERVER_URL}/?mockAudio=1&renderer=${renderer}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector('canvas');
        return Boolean(canvas && canvas.width >= 640 && canvas.height >= 360);
      },
      { timeout: 60000 },
    );

    return await page.evaluate(async (frames) => {
      const load = <T>(path: string) =>
        import(/* @vite-ignore */ path) as Promise<T>;
      type Sampler = {
        capture: (
          canvas: HTMLCanvasElement,
          onGrid: (tiles: Float32Array | null) => void,
        ) => boolean;
        readonly offThread: boolean;
        dispose: () => void;
      };
      const { createFlashSampler, createMainThreadFlashReader } = await load<{
        createFlashSampler: (grid: number) => Sampler;
        createMainThreadFlashReader: (grid: number) => {
          read: (canvas: HTMLCanvasElement) => Float32Array | null;
          dispose: () => void;
        };
      }>('/src/js/core/services/flash-sampler.ts');
      const { subscribeToFrameDrawn } = await load<{
        subscribeToFrameDrawn: (listener: () => void) => () => void;
      }>('/src/js/core/frame-drawn.ts');

      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      const sampler = createFlashSampler(16);
      const reader = createMainThreadFlashReader(16);
      const pairs: Array<{ off: number[] | null; main: number[] }> = [];

      // The first frames after load can be black while the preset compiles;
      // wait until the stage shows something before comparing anything.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          stop();
          reject(new Error('the stage stayed black for 30s'));
        }, 30000);
        const stop = subscribeToFrameDrawn(() => {
          const tiles = reader.read(canvas);
          if (!tiles) return;
          let sum = 0;
          for (const value of tiles) sum += value;
          if (sum / tiles.length > 0.001) {
            clearTimeout(timer);
            stop();
            resolve();
          }
        });
      });

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          stop();
          reject(new Error(`${pairs.length} of ${frames} grids in 30s`));
        }, 30000);
        const stop = subscribeToFrameDrawn(() => {
          if (pairs.length >= frames) return;
          const pair: { off: number[] | null; main: number[] } = {
            off: null,
            main: [],
          };
          const captured = sampler.capture(canvas, (tiles) => {
            pair.off = tiles ? Array.from(tiles) : [];
            if (pairs.length >= frames && pairs.every((p) => p.off)) {
              clearTimeout(timer);
              stop();
              resolve();
            }
          });
          if (!captured) return;
          pair.main = Array.from(reader.read(canvas) ?? []);
          pairs.push(pair);
        });
      });

      let maxDifference = 0;
      let total = 0;
      let count = 0;
      for (const { off, main } of pairs) {
        if (!off || off.length !== main.length || main.length === 0) {
          maxDifference = Number.POSITIVE_INFINITY;
          continue;
        }
        for (let i = 0; i < main.length; i += 1) {
          maxDifference = Math.max(
            maxDifference,
            Math.abs((off[i] as number) - (main[i] as number)),
          );
          total += main[i] as number;
          count += 1;
        }
      }
      const offThread = sampler.offThread;
      sampler.dispose();
      reader.dispose();
      return {
        offThread,
        compared: pairs.length,
        maxDifference,
        meanLuminance: count > 0 ? total / count : 0,
      };
    }, FRAMES);
  } finally {
    await browser.close();
  }
}

function expectSameFrame(result: Comparison) {
  expect(result.offThread).toBe(true);
  expect(result.compared).toBe(FRAMES);
  // A blank stage would match a blank snapshot and prove nothing.
  expect(result.meanLuminance).toBeGreaterThan(0.001);
  expect(result.maxDifference).toBeLessThan(0.002);
}

requiredBrowserTest(
  'on WebGL the worker reads the same frame the draw produced',
  async () => {
    expectSameFrame(await compareReadbacks('webgl'));
  },
  { timeout: 120000 },
);

localOnlyBrowserTest(
  'on WebGPU the worker reads the same frame the draw produced',
  async () => {
    expectSameFrame(await compareReadbacks('webgpu'));
  },
  { timeout: 120000 },
);
