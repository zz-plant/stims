/**
 * Measure what per-frame flash sampling costs on a live canvas.
 *
 * The flash governor only governs if something feeds it a luminance grid
 * every frame, and that sample is a GPU->CPU sync. The compute-VM
 * measurement (d3e47f70) is the cautionary tale: an unmeasured per-frame
 * round trip there cost 1.1-6.8ms, most of a frame budget, for work the CPU
 * did in nanoseconds. So this number gets measured before the sampler is
 * wired into the loop, not after.
 *
 * Times createFlashSampler().sample() against the real running visualizer
 * canvas on a real GPU, at several grid sizes, and reports microseconds per
 * sample plus what fraction of a 16.7ms frame that is.
 *
 * Each sample is taken the way the app takes it: once per drawn frame,
 * inside the render loop's frame-drawn notification, outside agent mode.
 * The first version timed 20 reads back to back in agent mode; only the
 * first of each batch waited for the GPU and the rest read a copy the
 * browser already held, so it reported ~10us for a read that costs
 * milliseconds.
 *
 *   bun run lab:flash-sampler-bench
 *   bun run lab:flash-sampler-bench -- --iterations 200 --renderer webgl
 */
import { chromium } from 'playwright';
import { ensureDevServer } from './dev-server.ts';

const PORT = Number(process.env.FLASH_BENCH_PORT ?? 5201);
const args = process.argv.slice(2);
const inline = args.find((a) => a.startsWith('--iterations='));
const idx = args.indexOf('--iterations');
const ITERATIONS = inline
  ? Number(inline.split('=')[1])
  : idx >= 0 && args[idx + 1]
    ? Number(args[idx + 1])
    : 120;
const rendererIdx = args.indexOf('--renderer');
const RENDERER = rendererIdx >= 0 ? args[rendererIdx + 1] : null;

const server = await ensureDevServer(PORT, process.cwd());
// channel 'chromium': the default headless shell has no usable WebGPU and
// reads an all-zero canvas, which would time a fake outage.
const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: [
    '--use-gl=angle',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu',
  ],
});

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`  [page] ${m.text()}`);
  });
  const rendererQuery = RENDERER ? `&renderer=${RENDERER}` : '';
  await page.goto(`http://127.0.0.1:${PORT}/?mockAudio=1${rendererQuery}`, {
    waitUntil: 'domcontentloaded',
  });

  // Wait for a canvas with real pixels; sampling a 0x0 canvas measures nothing.
  await page.waitForFunction(
    () => {
      const c = document.querySelector('canvas');
      // A 28x28 canvas is the pre-layout placeholder; measuring against it
      // reports sync overhead with no real surface behind it.
      return Boolean(c && c.width >= 640 && c.height >= 360);
    },
    { timeout: 60_000 },
  );

  const results = await page.evaluate(
    async ({ iterations }) => {
      const load = <T>(s: string) => import(/* @vite-ignore */ s) as Promise<T>;
      const { createFlashSampler } = await load<{
        createFlashSampler: (grid: number) => {
          sample: (canvas: HTMLCanvasElement) => void;
          dispose: () => void;
        };
      }>('/src/js/core/services/flash-sampler.ts');
      const { subscribeToFrameDrawn } = await load<{
        subscribeToFrameDrawn: (listener: () => void) => () => void;
      }>('/src/js/core/frame-drawn.ts');
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      if (!canvas) return { error: 'no canvas' };

      const stats = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const at = (p: number) =>
          sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
        return { median: at(0.5), p95: at(0.95) };
      };

      // One sample per drawn frame, timed alone: the cost being measured is
      // the wait for the GPU to finish that frame, which a batch of reads of
      // the same frame would pay once and then hide.
      const timeInFrames = (
        sampler: { sample: (c: HTMLCanvasElement) => void },
        count: number,
      ) =>
        new Promise<number[]>((resolve, reject) => {
          const times: number[] = [];
          const timer = setTimeout(() => {
            stop();
            reject(new Error(`only ${times.length} frames drawn in 30s`));
          }, 30_000);
          const stop = subscribeToFrameDrawn(() => {
            const t0 = performance.now();
            sampler.sample(canvas);
            times.push((performance.now() - t0) * 1000);
            if (times.length >= count) {
              clearTimeout(timer);
              stop();
              resolve(times);
            }
          });
        });

      type BenchResultRow = { grid: number; median: number; p95: number };
      const rows: BenchResultRow[] = [];
      for (const grid of [8, 16, 32, 64]) {
        const sampler = createFlashSampler(grid);
        await timeInFrames(sampler, 10);
        const times = await timeInFrames(sampler, iterations);
        sampler.dispose();
        rows.push({ grid, ...stats(times) });
      }
      return {
        rows,
        canvas: { width: canvas.width, height: canvas.height },
      };
    },
    { iterations: ITERATIONS },
  );

  if ('error' in results && results.error)
    throw new Error(String(results.error));
  const { rows, canvas } = results as {
    rows: Array<{ grid: number; median: number; p95: number }>;
    canvas: { width: number; height: number };
  };
  console.log(`\n  Source canvas: ${canvas.width}x${canvas.height}`);
  console.log('\n  grid    median us   p95 us   % of 16.7ms frame');
  console.log(`  ${'-'.repeat(50)}`);
  for (const row of rows) {
    const pct = (row.median / 1000 / 16.7) * 100;
    console.log(
      `  ${String(row.grid).padStart(4)}   ${row.median.toFixed(1).padStart(9)}   ${row.p95.toFixed(1).padStart(6)}   ${pct.toFixed(2).padStart(6)}%`,
    );
  }
  console.log('');
} finally {
  await browser.close();
  server?.close?.();
}
