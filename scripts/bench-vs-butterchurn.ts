/**
 * Head-to-head per-frame render benchmark: Stims vs Butterchurn 2.6.7.
 *
 * "How far behind Butterchurn are we?" as a re-measurable number. Our .milk
 * corpus was transpiled from Butterchurn's own converted-preset JSON, so both
 * engines can be pointed at the same presets and the comparison is apples to
 * apples at the preset level.
 *
 * Usage:
 *   bun run bench:butterchurn                      # 12 presets, quality step 0
 *   bun run bench:butterchurn -- --sample=24
 *   bun run bench:butterchurn -- --ids=geiss-casino,flexi-dawn
 *   bun run bench:butterchurn -- --quality-step=1
 *   bun run bench:butterchurn -- --port=5190 --json=bench.json
 *   bun run bench:butterchurn -- --renderer=webgpu   # measure the WebGPU path
 *
 * Not wired into CI or any quality gate on purpose: it needs a real GPU and
 * takes minutes.
 *
 * FAIRNESS CONTROLS — each of these was learned by getting a wrong number
 * first. Do not "simplify" them away.
 *
 *  1. Each engine runs ALONE in its own browser process, measured
 *     sequentially. Two pages in one browser context gives background-tab
 *     throttling: Stims measured 10-12ms with a Butterchurn page alive vs
 *     4.2ms alone. That trap produced a bogus "13x slower" headline.
 *  2. Every Stims preset is loaded by URL at boot
 *     (?preset=<id>&agent=true&renderer=webgl&lockQualityStep=N), NEVER via
 *     the agent-bridge postMessage swap, which costs 2.8x more for reasons
 *     still under investigation.
 *  3. Butterchurn's canvas is sized to Stims' ACTUAL drawing buffer (read
 *     from gl.drawingBufferWidth/Height — Stims supersamples, so a 1280x720
 *     viewport yields e.g. a 1521x865 buffer), not to the viewport.
 *  4. gl.finish() before and after each timed block on both sides, so queued
 *     GPU work is paid for inside the timed region.
 *  5. Median and p95 per frame are reported, never a mean — one shader-compile
 *     hitch dominates a mean.
 *  6. Butterchurn's UMD build exposes the API at
 *     window.butterchurn.default.createVisualizer (NOT
 *     window.butterchurn.createVisualizer). Presets come from
 *     window.butterchurnPresets.getPresets().
 *  7. Preset sampling is deterministic (stable stride over the matched pairs,
 *     or an explicit --ids list) so runs are comparable over time.
 *  8. --renderer=webgpu only REQUESTS WebGPU. A preset whose descriptor plan
 *     is unsupported falls back to WebGL (backend-fallback.ts reloads the page
 *     into the WebGL path), so the backend that actually rendered is read back
 *     per preset from the runtime debug handle and recorded on every row.
 *     Averaging across a mixed set would be meaningless.
 *
 * KNOWN REMAINING ASYMMETRIES, stated rather than hidden:
 *  - Stims steps its deterministic synthetic audio signal while Butterchurn
 *    reads a silent analyser, so per-preset branches can differ.
 *  - Stims renders inside its full app shell; Butterchurn renders to a bare
 *    canvas.
 *  - Mesh density is each engine's own choice (Butterchurn is fixed at 48x36).
 *  - With --renderer=webgpu there is no gl.finish() equivalent, so control 4's
 *    flush is a no-op on that path: WebGPU numbers bound CPU-side submission
 *    cost and may understate GPU work relative to the WebGL/Butterchurn rows.
 *
 * A preset that fails to load or render on either side is skipped and
 * reported — never zero-filled, never dropped silently from the denominator.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Browser, chromium } from 'playwright';
import { ensureDevServer } from './dev-server.ts';

// 5188+: several dev servers run concurrently on this machine, and colliding
// with one would silently benchmark somebody else's build.
const DEFAULT_PORT = 5188;
const DEFAULT_SAMPLE = 12;
// scratch/ is gitignored — benchmark output is a measurement, not a source
// artifact, and must not land in the working tree by default.
const DEFAULT_JSON = 'scratch/bench-vs-butterchurn.json';
const WARMUP_FRAMES = 120;
const MEASURE_FRAMES = 240;
const VIEWPORT = { width: 1280, height: 720 };
const BOOT_TIMEOUT_MS = 60000;
/**
 * Hard ceiling on one preset's measurement. `page.evaluate` has NO default
 * timeout in Playwright, and the measurement it runs is a synchronous
 * render loop — so a wedged GPU or a preset that never returns hangs the whole
 * benchmark forever, inside the per-preset try, where the catch can never fire.
 * Three runs were lost to that before this ceiling existed. Generous enough for
 * a slow preset (360 frames at 100ms is 36s) while still bounding the run.
 */
const PRESET_TIMEOUT_MS = 90000;
/**
 * A page stuck in a synchronous loop cannot be closed cooperatively — the close
 * handshake needs the page's main thread. Past this, kill the browser process.
 */
const TEARDOWN_TIMEOUT_MS = 10000;

class StepTimeout extends Error {
  constructor(label: string, ms: number) {
    super(`timed out after ${ms}ms: ${label}`);
    this.name = 'StepTimeout';
  }
}

/**
 * Reject if `work` outlives `ms`. The underlying promise is abandoned, not
 * cancelled — Playwright has no cancellation — so any caller that hits this
 * MUST tear the browser down rather than reuse it.
 */
async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StepTimeout(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Close a browser, escalating to SIGKILL when the handshake itself hangs. */
async function forceCloseBrowser(browser: Browser): Promise<void> {
  try {
    await withDeadline(browser.close(), TEARDOWN_TIMEOUT_MS, 'browser.close');
  } catch {
    // `process()` exists on the Chromium browser at runtime but is absent from
    // Playwright's public Browser type; a wedged page leaves no other way out.
    (
      browser as unknown as {
        process?: () => { kill: (signal: string) => void } | null;
      }
    )
      .process?.()
      ?.kill('SIGKILL');
  }
}

const BUTTERCHURN_LIB = 'node_modules/butterchurn/lib/butterchurn.min.js';
const PRESETS_LIB =
  'node_modules/butterchurn-presets/lib/butterchurnPresets.min.js';

interface CatalogPreset {
  id: string;
  title: string;
  file: string;
}

interface Pair {
  id: string;
  bcKey: string;
}

type Renderer = 'webgl' | 'webgpu';

interface Row {
  id: string;
  bcKey: string;
  /** Backend that actually rendered, read back from the runtime (control 8). */
  stimsBackend: 'webgl' | 'webgpu' | 'unknown';
  bcMedian: number;
  bcP95: number;
  stimsMedian: number;
  stimsP95: number;
  ratio: number;
}

interface StimsResult {
  median: number;
  p95: number;
  backend: 'webgl' | 'webgpu' | 'unknown';
}

interface Skip {
  id: string;
  engine: 'stims' | 'butterchurn';
  reason: string;
}

function parseArgs() {
  const args: {
    sample: number;
    ids?: string[];
    qualityStep: string;
    port: number;
    json: string;
    renderer: Renderer;
  } = {
    sample: DEFAULT_SAMPLE,
    qualityStep: '0',
    port: DEFAULT_PORT,
    json: DEFAULT_JSON,
    // Default webgl: the historical baseline this file's numbers were built on.
    renderer: 'webgl',
  };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--sample=')) args.sample = parseInt(arg.slice(9), 10);
    if (arg.startsWith('--ids='))
      args.ids = arg
        .slice(6)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    if (arg.startsWith('--quality-step=')) args.qualityStep = arg.slice(15);
    if (arg.startsWith('--port=')) args.port = parseInt(arg.slice(7), 10);
    if (arg.startsWith('--json=')) args.json = arg.slice(7);
    if (arg.startsWith('--renderer=')) {
      const value = arg.slice(11);
      if (value !== 'webgl' && value !== 'webgpu') {
        console.error(`--renderer must be webgl or webgpu, got "${value}"`);
        process.exit(1);
      }
      args.renderer = value;
    }
  }
  return args;
}

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Percentile of an unsorted sample. Never a mean — see control 5. */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const launchBrowser = (): Promise<Browser> =>
  chromium.launch({
    // Full Chromium (--headless=new), not the headless shell: the shell only
    // rasterizes through SwiftShader, which would benchmark the CPU.
    channel: 'chromium',
    headless: true,
    args: [
      '--use-angle=metal',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  });

function stimsUrl(
  port: number,
  id: string,
  qualityStep: string,
  renderer: Renderer,
): string {
  // Control 2: boot the preset from the URL. lockQualityStep pins the
  // adaptive-quality controller so the drawing buffer cannot shrink mid-run.
  return `http://localhost:${port}/?preset=${id}&agent=true&renderer=${renderer}&lockQualityStep=${qualityStep}`;
}

/**
 * Control 8: which backend actually rendered. The agent-mode runtime debug
 * handle is authoritative; the agent telemetry object is the fallback for the
 * window between mount and the first telemetry publish.
 */
function readStimsBackend(
  page: import('playwright').Page,
): Promise<'webgl' | 'webgpu' | 'unknown'> {
  return page.evaluate(() => {
    const debug = (
      window as unknown as {
        __milkdropRuntimeDebug?: {
          getState: () => { backend: 'webgl' | 'webgpu' };
        };
        __STIMS_AGENT_TELEMETRY__?: { backend?: string };
      }
    ).__milkdropRuntimeDebug;
    const fromDebug = debug?.getState?.().backend;
    if (fromDebug === 'webgl' || fromDebug === 'webgpu') return fromDebug;
    const fromTelemetry = (
      window as unknown as { __STIMS_AGENT_TELEMETRY__?: { backend?: string } }
    ).__STIMS_AGENT_TELEMETRY__?.backend;
    return fromTelemetry === 'webgl' || fromTelemetry === 'webgpu'
      ? fromTelemetry
      : 'unknown';
  }) as Promise<'webgl' | 'webgpu' | 'unknown'>;
}

const waitForRenderHook = (page: import('playwright').Page) =>
  page.waitForFunction(
    () => typeof window.__STIMS_AGENT_RENDER_FRAMES__ === 'function',
    undefined,
    { timeout: BOOT_TIMEOUT_MS },
  );

/**
 * Wait for the stage canvas to reach its real backing size. On the WebGPU path
 * the render hook is registered before the renderer configures its surface, so
 * probing immediately reads the 300x150 default canvas size — which would size
 * Butterchurn's canvas to 300x150 and break control 3.
 */
const waitForStageSurface = (page: import('playwright').Page) =>
  page.waitForFunction(
    () => {
      const canvas = [...document.querySelectorAll('canvas')].sort(
        (a, b) => b.width * b.height - a.width * a.height,
      )[0];
      return !!canvas && canvas.width >= 640 && canvas.height >= 360;
    },
    undefined,
    { timeout: BOOT_TIMEOUT_MS },
  );

/** Frame timings from the Stims stage canvas, or null if the hook refused. */
function measureStims(
  page: import('playwright').Page,
): Promise<number[] | null> {
  return page.evaluate(
    ({ warmup, measure }) => {
      const step = window.__STIMS_AGENT_RENDER_FRAMES__;
      if (typeof step !== 'function') return null;
      // The stage canvas is the largest one; the rest are identicons/HUD.
      const canvas = [...document.querySelectorAll('canvas')].sort(
        (a, b) => b.width * b.height - a.width * a.height,
      )[0] as HTMLCanvasElement | undefined;
      if (!canvas) return null;
      // On the WebGPU path this canvas has a 'webgpu' context and getContext
      // ('webgl2') returns null. That is not a failure — the gl.finish() flush
      // of control 4 simply has no WebGL equivalent to call there.
      const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
      if (!step({ frames: warmup })) return null;
      gl?.finish(); // control 4: warmup GPU work paid for before timing starts
      const timings: number[] = [];
      for (let i = 0; i < measure; i++) {
        const t0 = performance.now();
        step({ frames: 1 });
        timings.push(performance.now() - t0);
      }
      gl?.finish(); // control 4: no queued work escapes the timed region
      return timings;
    },
    { warmup: WARMUP_FRAMES, measure: MEASURE_FRAMES },
  ) as Promise<number[] | null>;
}

async function readStimsBufferSize(
  port: number,
  qualityStep: string,
  probeId: string,
  renderer: Renderer,
): Promise<{ width: number; height: number }> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(stimsUrl(port, probeId, qualityStep, renderer), {
      waitUntil: 'domcontentloaded',
    });
    await waitForRenderHook(page);
    await waitForStageSurface(page);
    // Control 3: the real drawing buffer, not the viewport — Stims supersamples.
    return (await page.evaluate(() => {
      const canvas = [...document.querySelectorAll('canvas')].sort(
        (a, b) => b.width * b.height - a.width * a.height,
      )[0] as HTMLCanvasElement;
      // On the WebGPU path there is no WebGL context to ask; the canvas's own
      // backing store is the surface the renderer configures.
      const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
      return gl
        ? { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight }
        : { width: canvas.width, height: canvas.height };
    })) as { width: number; height: number };
  } finally {
    await browser.close();
  }
}

async function readButterchurnKeys(presetsSrc: string): Promise<string[]> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="c"></canvas>');
    await page.addScriptTag({ content: presetsSrc });
    return (await page.evaluate(() => {
      // Control 6: presets live behind getPresets() on the UMD global.
      const root = (
        window as unknown as {
          butterchurnPresets?: { getPresets?: () => Record<string, unknown> };
        }
      ).butterchurnPresets;
      const presets = root?.getPresets ? root.getPresets() : (root ?? {});
      return Object.keys(presets);
    })) as string[];
  } finally {
    await browser.close();
  }
}

/** Control 1: Stims alone in its own browser process. */
async function runStimsPhase(
  sample: Pair[],
  port: number,
  qualityStep: string,
  renderer: Renderer,
  skips: Skip[],
): Promise<Map<string, StimsResult>> {
  const results = new Map<string, StimsResult>();
  let browser = await launchBrowser();
  try {
    for (const pair of sample) {
      const startedAt = Date.now();
      // A fresh page per preset: control 2 forbids the postMessage swap.
      const page = await browser.newPage({ viewport: VIEWPORT });
      let wedged = false;
      try {
        const step = <T>(work: Promise<T>, label: string) =>
          withDeadline(work, PRESET_TIMEOUT_MS, `${pair.id}: ${label}`);
        await step(
          page.goto(stimsUrl(port, pair.id, qualityStep, renderer), {
            waitUntil: 'domcontentloaded',
          }),
          'goto',
        );
        await step(waitForRenderHook(page), 'render hook');
        await step(waitForStageSurface(page), 'stage surface');
        const timings = await step(measureStims(page), 'measure');
        // Read after the measured run: a descriptor fallback reloads the page
        // into WebGL, so the backend at boot is not necessarily the one that
        // produced these frames (control 8).
        const backend = await step(readStimsBackend(page), 'backend readback');
        if (!timings || timings.length === 0) {
          skips.push({
            id: pair.id,
            engine: 'stims',
            reason: 'render hook returned no frames',
          });
          console.log(`  stims SKIP ${pair.id} — render hook returned nothing`);
          continue;
        }
        const median = percentile(timings, 0.5);
        // A 0.00ms median means the hook returned without rendering (a paused
        // runtime, or a descriptor-fallback reload that tore the engine down
        // mid-run). Recording it would report "infinitely fast" — skip it.
        if (median === 0) {
          skips.push({
            id: pair.id,
            engine: 'stims',
            reason: `zero-cost frames — runtime not rendering (backend ${backend})`,
          });
          console.log(`  stims SKIP ${pair.id} — zero-cost frames`);
          continue;
        }
        results.set(pair.id, {
          median,
          p95: percentile(timings, 0.95),
          backend,
        });
        console.log(
          `  stims ${median.toFixed(2).padStart(6)}ms  [${backend}]  ${pair.id}` +
            `  (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // A deadline means the page is still spinning on an abandoned promise;
        // it cannot be reused and often cannot even be closed cooperatively.
        wedged = error instanceof StepTimeout;
        skips.push({ id: pair.id, engine: 'stims', reason });
        console.log(`  stims SKIP ${pair.id} — ${reason}`);
      } finally {
        if (!wedged) {
          // A cooperative close needs the page's main thread; if that also
          // hangs, the page is wedged after all.
          wedged = await withDeadline(
            page.close(),
            TEARDOWN_TIMEOUT_MS,
            'page.close',
          ).then(
            () => false,
            () => true,
          );
        }
        if (wedged) {
          // Replace the whole browser: a wedged renderer would otherwise leak
          // GPU work into every later preset's timings.
          await forceCloseBrowser(browser);
          browser = await launchBrowser();
        }
      }
    }
  } finally {
    await forceCloseBrowser(browser);
  }
  return results;
}

/** Control 1: Butterchurn alone, after the Stims browser is fully closed. */
async function runButterchurnPhase(
  sample: Pair[],
  buffer: { width: number; height: number },
  butterchurnSrc: string,
  presetsSrc: string,
  skips: Skip[],
): Promise<Map<string, { median: number; p95: number }>> {
  const results = new Map<string, { median: number; p95: number }>();
  let browser = await launchBrowser();
  // Unlike the Stims phase, every preset shares one visualizer page — so a
  // single wedged preset would take every later preset down with it. This is
  // rebuilt from scratch whenever that happens.
  const createVisualizerPage = async (target: Browser) => {
    const page = await target.newPage({ viewport: VIEWPORT });
    await page.setContent(
      `<canvas id="c" width="${buffer.width}" height="${buffer.height}"></canvas>`,
    );
    await page.addScriptTag({ content: butterchurnSrc });
    await page.addScriptTag({ content: presetsSrc });
    await page.evaluate(
      ({ width, height }) => {
        const win = window as unknown as Record<string, unknown>;
        // Control 6: the UMD build nests the API under `.default`.
        const api =
          (win.butterchurn as { default?: unknown }).default ?? win.butterchurn;
        const audio = new AudioContext();
        const canvas = document.getElementById('c') as HTMLCanvasElement;
        // Control 3: match Stims' drawing buffer exactly, pixelRatio 1.
        canvas.width = width;
        canvas.height = height;
        const visualizer = (
          api as {
            createVisualizer: (a: unknown, c: unknown, o: unknown) => unknown;
          }
        ).createVisualizer(audio, canvas, {
          width,
          height,
          pixelRatio: 1,
        }) as { connectAudio: (node: unknown) => void };
        // Silent analyser source — see the asymmetry note in the header.
        visualizer.connectAudio(audio.createGain());
        win.__bcVisualizer__ = visualizer;
        const root = win.butterchurnPresets as {
          getPresets?: () => Record<string, unknown>;
        };
        win.__bcPresets__ = root.getPresets ? root.getPresets() : root;
      },
      { width: buffer.width, height: buffer.height },
    );
    return page;
  };

  let page = await createVisualizerPage(browser);
  try {
    for (const pair of sample) {
      let wedged = false;
      try {
        const timings = (await withDeadline(
          page.evaluate(
            ({ key, warmup, measure }) => {
              const win = window as unknown as {
                __bcVisualizer__: {
                  loadPreset: (preset: unknown, blend: number) => void;
                  render: () => void;
                };
                __bcPresets__: Record<string, unknown>;
              };
              const preset = win.__bcPresets__[key];
              if (!preset) return null;
              win.__bcVisualizer__.loadPreset(preset, 0);
              const canvas = document.getElementById('c') as HTMLCanvasElement;
              const gl = (canvas.getContext('webgl2') ??
                canvas.getContext('webgl')) as WebGLRenderingContext | null;
              if (!gl) return null;
              for (let i = 0; i < warmup; i++) win.__bcVisualizer__.render();
              gl.finish(); // control 4
              const samples: number[] = [];
              for (let i = 0; i < measure; i++) {
                const t0 = performance.now();
                win.__bcVisualizer__.render();
                samples.push(performance.now() - t0);
              }
              gl.finish(); // control 4
              return samples;
            },
            {
              key: pair.bcKey,
              warmup: WARMUP_FRAMES,
              measure: MEASURE_FRAMES,
            },
          ),
          PRESET_TIMEOUT_MS,
          `${pair.id}: butterchurn measure`,
        )) as number[] | null;
        if (!timings || timings.length === 0) {
          skips.push({
            id: pair.id,
            engine: 'butterchurn',
            reason: `preset "${pair.bcKey}" failed to render`,
          });
          console.log(`  bc SKIP ${pair.id} — failed to render`);
          continue;
        }
        results.set(pair.id, {
          median: percentile(timings, 0.5),
          p95: percentile(timings, 0.95),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        wedged = error instanceof StepTimeout;
        skips.push({ id: pair.id, engine: 'butterchurn', reason });
        console.log(`  bc SKIP ${pair.id} — ${reason}`);
      } finally {
        if (wedged) {
          await forceCloseBrowser(browser);
          browser = await launchBrowser();
          page = await createVisualizerPage(browser);
        }
      }
    }
  } finally {
    await forceCloseBrowser(browser);
  }
  return results;
}

async function main() {
  const args = parseArgs();
  const butterchurnSrc = readFileSync(BUTTERCHURN_LIB, 'utf8');
  const presetsSrc = readFileSync(PRESETS_LIB, 'utf8');
  const butterchurnVersion = (
    JSON.parse(
      readFileSync('node_modules/butterchurn/package.json', 'utf8'),
    ) as { version: string }
  ).version;

  const catalog = JSON.parse(
    readFileSync('public/milkdrop-presets/catalog.json', 'utf8'),
  ) as { presets: CatalogPreset[] };
  // Only the Butterchurn-derived corpus: those are the presets both engines
  // genuinely share.
  const ours = catalog.presets.filter((p) => p.file.includes('/butterchurn/'));

  const server = await ensureDevServer(args.port);
  try {
    const keys = await readButterchurnKeys(presetsSrc);
    const byNormalizedTitle = new Map(keys.map((k) => [normalize(k), k]));
    const pairs: Pair[] = ours
      .map((p) => ({
        id: p.id,
        bcKey: byNormalizedTitle.get(normalize(p.title)),
      }))
      .filter((p): p is Pair => Boolean(p.bcKey));

    // Deterministic selection (control 7): explicit ids, else a stable stride.
    let sample: Pair[];
    if (args.ids) {
      const wanted = new Set(args.ids);
      sample = pairs.filter((p) => wanted.has(p.id));
      const missing = args.ids.filter((id) => !sample.some((p) => p.id === id));
      if (missing.length > 0) {
        console.log(
          `unmatched ids (no Butterchurn twin): ${missing.join(', ')}`,
        );
      }
    } else {
      const stride = Math.max(1, Math.floor(pairs.length / args.sample));
      sample = pairs.filter((_, i) => i % stride === 0).slice(0, args.sample);
    }
    if (sample.length === 0) {
      console.error('No presets to benchmark.');
      process.exit(1);
    }
    console.log(
      `matched presets: ${pairs.length}, benchmarking ${sample.length}`,
    );

    const buffer = await readStimsBufferSize(
      args.port,
      args.qualityStep,
      sample[0].id,
      args.renderer,
    );
    console.log(
      `stims drawing buffer: ${buffer.width}x${buffer.height} (quality step ${args.qualityStep}, renderer ${args.renderer})`,
    );

    const skips: Skip[] = [];
    console.log('\n--- phase 1: stims (alone) ---');
    const stimsResults = await runStimsPhase(
      sample,
      args.port,
      args.qualityStep,
      args.renderer,
      skips,
    );
    console.log('\n--- phase 2: butterchurn (alone) ---');
    const bcResults = await runButterchurnPhase(
      sample,
      buffer,
      butterchurnSrc,
      presetsSrc,
      skips,
    );

    const rows: Row[] = [];
    for (const pair of sample) {
      const stims = stimsResults.get(pair.id);
      const bc = bcResults.get(pair.id);
      // A preset measured on only one engine is not comparable; it already
      // has a skip entry and must not enter the denominator.
      if (!stims || !bc) continue;
      rows.push({
        id: pair.id,
        bcKey: pair.bcKey,
        stimsBackend: stims.backend,
        bcMedian: Number(bc.median.toFixed(3)),
        bcP95: Number(bc.p95.toFixed(3)),
        stimsMedian: Number(stims.median.toFixed(3)),
        stimsP95: Number(stims.p95.toFixed(3)),
        ratio: Number((stims.median / bc.median).toFixed(2)),
      });
    }

    if (rows.length === 0) {
      console.error('\nNo preset was measured on both engines.');
      process.exit(1);
    }

    console.log('\n--- per preset ---');
    for (const row of rows) {
      console.log(
        `  bc ${row.bcMedian.toFixed(2).padStart(6)}ms  stims ${row.stimsMedian
          .toFixed(2)
          .padStart(6)}ms  (${row.ratio}x)  [${row.stimsBackend}]  ${row.id}`,
      );
    }

    const bcMedians = rows.map((r) => r.bcMedian);
    const stimsMedians = rows.map((r) => r.stimsMedian);
    const ratios = rows.map((r) => r.ratio);
    const summary = {
      presetsCompared: rows.length,
      presetsSkipped: skips.length,
      butterchurnMedianMs: Number(percentile(bcMedians, 0.5).toFixed(3)),
      butterchurnP95Ms: Number(
        percentile(
          rows.map((r) => r.bcP95),
          0.95,
        ).toFixed(3),
      ),
      stimsMedianMs: Number(percentile(stimsMedians, 0.5).toFixed(3)),
      stimsP95Ms: Number(
        percentile(
          rows.map((r) => r.stimsP95),
          0.95,
        ).toFixed(3),
      ),
      ratioMedian: Number(percentile(ratios, 0.5).toFixed(2)),
      ratioBest: Number(Math.min(...ratios).toFixed(2)),
      ratioWorst: Number(Math.max(...ratios).toFixed(2)),
      stimsFasterCount: ratios.filter((r) => r < 1).length,
      // Control 8: a median mixing genuinely-WebGPU rows with fallen-back rows
      // describes neither backend, so segment it.
      byBackend: Object.fromEntries(
        (['webgl', 'webgpu', 'unknown'] as const)
          .map((backend) => {
            const subset = rows.filter((r) => r.stimsBackend === backend);
            if (subset.length === 0) return null;
            return [
              backend,
              {
                count: subset.length,
                stimsMedianMs: Number(
                  percentile(
                    subset.map((r) => r.stimsMedian),
                    0.5,
                  ).toFixed(3),
                ),
                stimsP95Ms: Number(
                  percentile(
                    subset.map((r) => r.stimsP95),
                    0.95,
                  ).toFixed(3),
                ),
                ratioMedian: Number(
                  percentile(
                    subset.map((r) => r.ratio),
                    0.5,
                  ).toFixed(2),
                ),
              },
            ] as const;
          })
          .filter(
            (entry): entry is NonNullable<typeof entry> => entry !== null,
          ),
      ),
    };

    console.log('\n=== summary ===');
    console.log(
      `presets compared: ${summary.presetsCompared}  skipped: ${summary.presetsSkipped}`,
    );
    console.log(
      `buffer ${buffer.width}x${buffer.height}  quality step ${args.qualityStep}  butterchurn ${butterchurnVersion}`,
    );
    console.log(
      `butterchurn per-frame: median ${summary.butterchurnMedianMs.toFixed(2)}ms  p95 ${summary.butterchurnP95Ms.toFixed(2)}ms`,
    );
    console.log(
      `stims       per-frame: median ${summary.stimsMedianMs.toFixed(2)}ms  p95 ${summary.stimsP95Ms.toFixed(2)}ms`,
    );
    console.log(
      `stims/butterchurn: median ${summary.ratioMedian.toFixed(2)}x  best ${summary.ratioBest.toFixed(2)}x  worst ${summary.ratioWorst.toFixed(2)}x`,
    );
    console.log(
      `stims faster on ${summary.stimsFasterCount} of ${summary.presetsCompared} presets`,
    );
    console.log(`requested renderer: ${args.renderer}`);
    for (const [backend, stats] of Object.entries(summary.byBackend)) {
      console.log(
        `  actual ${backend.padEnd(7)} n=${stats.count}  median ${stats.stimsMedianMs.toFixed(2)}ms  p95 ${stats.stimsP95Ms.toFixed(2)}ms  vs bc ${stats.ratioMedian.toFixed(2)}x`,
      );
    }
    if (skips.length > 0) {
      console.log('\nskipped:');
      for (const skip of skips) {
        console.log(`  ${skip.engine} ${skip.id} — ${skip.reason}`);
      }
    }

    mkdirSync(dirname(args.json), { recursive: true });
    writeFileSync(
      args.json,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          butterchurnVersion,
          qualityStep: args.qualityStep,
          requestedRenderer: args.renderer,
          viewport: VIEWPORT,
          drawingBuffer: buffer,
          warmupFrames: WARMUP_FRAMES,
          measureFrames: MEASURE_FRAMES,
          summary,
          rows,
          skipped: skips,
        },
        null,
        2,
      ),
    );
    console.log(`\nwrote ${args.json}`);

    // A partial run must not look like a passing one. An earlier run exited 0
    // after measuring 4 of 8 presets, which any automated consumer would have
    // read as success. Incomplete coverage is a failure, and the JSON above is
    // written first so a partial result is still inspectable.
    if (skips.length > 0 || summary.presetsCompared < sample.length) {
      console.error(
        `\nINCOMPLETE: compared ${summary.presetsCompared} of ${sample.length} presets, ` +
          `${skips.length} skip(s). Results above are partial.`,
      );
      process.exitCode = 1;
    }
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
