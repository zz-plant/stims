/**
 * CPU-profile N stepped Stims frames and report self-time by function.
 *
 * Reuses the fairness controls learned by bench-vs-butterchurn.ts:
 *  - preset loaded by URL at boot (never the agent-bridge swap)
 *  - warmup frames paid for before the profiler starts
 *  - gl.finish() so queued GPU work does not leak across the timed region
 */
import { chromium } from 'playwright';
import {
  hardwareAngleArgs,
  isSoftwareRenderer,
  probeChromiumRendererString,
  softwareTimingWarning,
} from './browser-launch.ts';
import { ensureDevServer } from './dev-server.ts';

/**
 * Accepts both `--name=value` and `--name value`. Only the first form used to
 * parse, so the repo-standard `--preset <id>` was silently ignored and the
 * script profiled its default preset while reporting no error at all.
 */
const arg = (name: string, fallback: string) => {
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  const next = index === -1 ? undefined : process.argv[index + 1];
  return next && !next.startsWith('--') ? next : fallback;
};

const PORT = arg('port', '5992');
const PRESET = arg('preset', 'rovastar-parallel-universe');
const RENDERER = arg('renderer', 'webgl');
const QUALITY = arg('quality-step', '0');
const WARMUP = Number(arg('warmup', '60'));
const FRAMES_REQUESTED = arg('frames', '');
let FRAMES = Number(FRAMES_REQUESTED || '200');
/** Wall-clock budget for the timed loop when --frames is not given. */
const TARGET_LOOP_MS = 20_000;
const TOP = Number(arg('top', '30'));

type Node = {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
  };
  hitCount?: number;
  children?: number[];
};

async function main() {
  // Started here rather than assumed: the script used to fail with a bare
  // ERR_CONNECTION_REFUSED against a port nothing documents.
  const devServer = await ensureDevServer(Number(PORT));
  const url = `http://localhost:${PORT}/?preset=${PRESET}&agent=true&renderer=${RENDERER}&lockQualityStep=${QUALITY}`;
  console.log(`Profiling ${PRESET} on ${RENDERER} (${FRAMES} frames)...`);
  const browser = await chromium.launch({
    args: [
      ...hardwareAngleArgs(),
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const gpuRenderer = await probeChromiumRendererString(context).catch(
    () => null,
  );
  const softwareRendering = isSoftwareRenderer(gpuRenderer);
  if (softwareRendering && gpuRenderer) {
    console.warn(`\n${softwareTimingWarning(gpuRenderer)}\n`);
  }
  const page = await context.newPage();
  console.log('Loading page...');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  await page.waitForFunction(
    () => typeof window.__STIMS_AGENT_RENDER_FRAMES__ === 'function',
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () => {
      const c = [...document.querySelectorAll('canvas')].sort(
        (a, b) => b.width * b.height - a.width * a.height,
      )[0];
      return !!c && c.width >= 640 && c.height >= 360;
    },
    undefined,
    { timeout: 60_000 },
  );

  const backend = await page.evaluate(
    () =>
      (
        window as unknown as {
          __milkdropRuntimeDebug?: { getState: () => { backend: string } };
        }
      ).__milkdropRuntimeDebug?.getState?.().backend ?? 'unknown',
  );

  // Warm up outside the profiled region. Timed, because the profiled loop is a
  // single synchronous evaluate that cannot report progress: the warmup rate
  // is the only way to know up front whether N frames will take seconds or
  // minutes on this host.
  console.log(`Warming up (${WARMUP} frames)...`);
  const warmupMs = await page.evaluate((w) => {
    const step = window.__STIMS_AGENT_RENDER_FRAMES__;
    const t0 = performance.now();
    step?.({ frames: w });
    const c = [...document.querySelectorAll('canvas')].sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0] as HTMLCanvasElement | undefined;
    (c?.getContext('webgl2') as WebGL2RenderingContext | null)?.finish();
    return performance.now() - t0;
  }, WARMUP);

  const msPerFrame = warmupMs / Math.max(1, WARMUP);
  if (!FRAMES_REQUESTED && msPerFrame * FRAMES > TARGET_LOOP_MS) {
    const scaled = Math.max(10, Math.floor(TARGET_LOOP_MS / msPerFrame));
    console.log(
      `Frames are slow here (~${msPerFrame.toFixed(0)} ms/frame), so ${FRAMES} would take ~${Math.round((msPerFrame * FRAMES) / 1000)}s: profiling ${scaled} instead. Pass --frames N to override.`,
    );
    FRAMES = scaled;
  }
  console.log(`Profiling ${FRAMES} frames (no output until it finishes)...`);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');

  const wall = await page.evaluate((n) => {
    const step = window.__STIMS_AGENT_RENDER_FRAMES__;
    const c = [...document.querySelectorAll('canvas')].sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0] as HTMLCanvasElement | undefined;
    const gl = c?.getContext('webgl2') as WebGL2RenderingContext | null;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) step?.({ frames: 1 });
    gl?.finish();
    return performance.now() - t0;
  }, FRAMES);

  const { profile } = await cdp.send('Profiler.stop');
  await browser.close();
  devServer.close();

  const nodes = profile.nodes as unknown as Node[];
  const totalHits = nodes.reduce((s, n) => s + (n.hitCount ?? 0), 0) || 1;

  // self time per function identity (name + file + line)
  const self = new Map<string, { hits: number; url: string }>();
  for (const n of nodes) {
    const hits = n.hitCount ?? 0;
    if (!hits) continue;
    const f = n.callFrame;
    const file = f.url.replace(/^https?:\/\/[^/]+/, '');
    const key = `${f.functionName || '(anonymous)'}  ${file}:${f.lineNumber + 1}`;
    const prev = self.get(key);
    self.set(key, { hits: (prev?.hits ?? 0) + hits, url: file });
  }

  const durationMs = (profile.endTime - profile.startTime) / 1000;
  const ranked = [...self.entries()].sort((a, b) => b[1].hits - a[1].hits);

  console.log(
    `\npreset=${PRESET} backend=${backend} renderer=${RENDERER} q=${QUALITY}`,
  );
  console.log(
    `${FRAMES} frames in ${wall.toFixed(1)}ms wall  =>  ${(wall / FRAMES).toFixed(3)} ms/frame`,
  );
  console.log(
    `profiler window ${durationMs.toFixed(1)}ms, ${totalHits} samples\n`,
  );
  console.log('  self%   self-ms   function');
  console.log('  ─────   ───────   ────────');
  for (const [key, v] of ranked.slice(0, TOP)) {
    const pct = (v.hits / totalHits) * 100;
    const ms = (v.hits / totalHits) * durationMs;
    if (pct < 0.4) break;
    console.log(
      `  ${pct.toFixed(1).padStart(5)}%  ${ms.toFixed(1).padStart(7)}   ${key}`,
    );
  }
  console.log('');
}

await main();
