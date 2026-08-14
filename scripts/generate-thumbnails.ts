/**
 * Batch preview generator — renders presets via Playwright + WebGL.
 *
 * Rather than waiting wall-clock time for presets to warm up, each preset is
 * rendered by synchronously pumping simulation frames through the engine's
 * agent hook (window.__STIMS_AGENT_RENDER_FRAMES__), then reading the canvas
 * framebuffer directly with toDataURL. No audio is started — the engine's
 * synthetic preview signal (a pure function of frame time) drives visuals,
 * so captures are fast, reproducible, and immune to RAF pauses. toDataURL
 * reads the framebuffer, not the composited page, so UI overlays can never
 * contaminate a capture.
 *
 * Black or byte-duplicate captures are never written: a stalled renderer
 * fails loudly (preview-failures.json) instead of poisoning the output dir.
 *
 * Usage:
 *   bun run scripts/generate-thumbnails.ts              # missing previews (up to --limit)
 *   bun run scripts/generate-thumbnails.ts --count=100  # first N missing
 *   bun run scripts/generate-thumbnails.ts --ids=geiss-casino,flexi-dawn
 *   bun run scripts/generate-thumbnails.ts --ids-file=path/to/ids.txt
 *   bun run scripts/generate-thumbnails.ts --all         # all presets
 *   bun run scripts/generate-thumbnails.ts --force       # overwrite existing
 *   bun run scripts/generate-thumbnails.ts --workers=8   # concurrency
 *   bun run scripts/generate-thumbnails.ts --port=5178   # dedicated dev server
 *   bun run scripts/generate-thumbnails.ts --no-headless # visible windows (debugging)
 *
 * Requires: Playwright Chromium installed. Dev server is started automatically.
 * Outputs: public/milkdrop-presets/previews/{presetId}.png (480×270)
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type BrowserContext, chromium } from 'playwright';
import sharp from 'sharp';
import { ensureDevServer } from './dev-server.ts';

const OUTPUT_DIR = 'public/milkdrop-presets/previews';
const PREVIEW_W = 480;
const PREVIEW_H = 270;
const DEFAULT_LIMIT = 50;
const DEFAULT_WORKERS = 8;
const DEFAULT_PORT = 5173;
// Simulated-frame budget per capture attempt (60fps sim time). Feedback
// presets need seconds of accumulation to show structure, but too much
// accumulation saturates additive presets to solid white — so the page
// checkpoints every CHECK_EVERY frames and captures the first good frame.
// Fast-saturating presets blow out to white within a second of sim time,
// so checkpoints start at 15 frames and sample finely early on.
const MIN_FRAMES = 15;
const MAX_FRAMES = 600;
const MAX_RETRIES = 1;
// Generous under load: 8 workers can stampede compiles + Vite transforms,
// especially while every page boots at once.
const BOOT_TIMEOUT_MS = 45000;
const SWAP_TIMEOUT_MS = 45000;
const PER_PRESET_TIMEOUT_MS = 120000;
// The stage is inset in home-mode layout (~65% of viewport), so the
// viewport must be larger than the target size for the stage framebuffer
// to exceed 480px; the readback is downscaled to the output size.
const CAPTURE_VIEWPORT = { width: 960, height: 540 };
// Recycle the long-lived page periodically so leaked GL resources from
// hundreds of preset compiles can't degrade later captures.
const PAGE_RECYCLE_EVERY = 100;

interface PresetEntry {
  id: string;
  title: string;
  preview?: unknown;
}

type CaptureFailure = {
  presetId: string;
  reason: string;
};

function parseArgs() {
  const args: {
    count?: number;
    ids?: string[];
    all?: boolean;
    force?: boolean;
    headless?: boolean;
    workers?: number;
    port?: number;
    beatPulse?: boolean;
    // Headless by default: launched via the 'chromium' channel
    // (--headless=new), captures still render on the real GPU, and the
    // whole window-occlusion problem class disappears. --no-headless
    // restores visible windows for debugging a capture.
  } = { headless: true };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--count=')) args.count = parseInt(arg.slice(8), 10);
    if (arg.startsWith('--ids=')) args.ids = arg.slice(6).split(',');
    if (arg.startsWith('--ids-file='))
      args.ids = readFileSync(arg.slice(11), 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    if (arg === '--all') args.all = true;
    if (arg === '--force') args.force = true;
    if (arg.startsWith('--workers='))
      args.workers = parseInt(arg.slice(10), 10);
    if (arg.startsWith('--port=')) args.port = parseInt(arg.slice(7), 10);
    if (arg === '--headless' || arg === '--headless=true') args.headless = true;
    if (arg === '--headless=false' || arg === '--no-headless')
      args.headless = false;
    // Overlay deterministic 2Hz beats on the synthetic audio — lights up
    // beat-gated presets that stay dark under the smooth idle signal.
    if (arg === '--beat-pulse') args.beatPulse = true;
  }
  return args;
}

async function getPresets(filter: {
  count?: number;
  ids?: string[];
  all?: boolean;
  force?: boolean;
}): Promise<PresetEntry[]> {
  const catalogPath = new URL(
    '../public/milkdrop-presets/catalog.json',
    import.meta.url,
  );
  const data = await Bun.file(catalogPath).json();
  const all = Array.isArray(data.presets)
    ? (data.presets as PresetEntry[])
    : [];

  if (filter.ids) {
    const idSet = new Set(filter.ids);
    return all.filter((p) => idSet.has(p.id));
  }

  if (filter.all) {
    return filter.force
      ? all
      : all.filter((p) => !existsSync(join(OUTPUT_DIR, `${p.id}.png`)));
  }

  const limit = filter.count ?? DEFAULT_LIMIT;
  if (filter.force) {
    return all.filter((p) => p.preview).slice(0, limit);
  }

  return all
    .filter((p) => p.preview && !existsSync(join(OUTPUT_DIR, `${p.id}.png`)))
    .slice(0, limit);
}

type FrameStats = {
  /** sha256 of the raw pixel buffer — byte-identical captures collide. */
  hash: string;
  meanLuma: number;
  maxLuma: number;
  stdLuma: number;
};

async function analyzeFrame(buffer: Buffer): Promise<FrameStats> {
  const { data, info } = await sharp(buffer)
    .resize(96, 54)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let sumSq = 0;
  let max = 0;
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const luma =
      0.299 * data[i] + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
    sum += luma;
    sumSq += luma * luma;
    if (luma > max) max = luma;
  }
  const mean = sum / pixels;
  return {
    hash: createHash('sha256').update(data).digest('hex'),
    meanLuma: mean,
    maxLuma: max,
    stdLuma: Math.sqrt(Math.max(0, sumSq / pixels - mean * mean)),
  };
}

/**
 * Useless as a preview: pure black, near-black noise, or a flat solid
 * color (including feedback loops blown out to solid white). Sparse-bright
 * presets (a few glowing shapes on black) are legitimate, so a low mean is
 * only fatal when nothing bright exists either.
 */
function badFrameReason(stats: FrameStats): string | null {
  if (stats.maxLuma < 32 || stats.meanLuma < 0.4) {
    return `black frame (mean=${stats.meanLuma.toFixed(1)}, max=${stats.maxLuma.toFixed(0)})`;
  }
  if (stats.stdLuma < 2.5) {
    return `flat frame (mean=${stats.meanLuma.toFixed(1)}, std=${stats.stdLuma.toFixed(1)})`;
  }
  return null;
}

async function writePreview(buffer: Buffer, filePath: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await sharp(buffer)
    .resize(PREVIEW_W, PREVIEW_H, { fit: 'cover', position: 'center' })
    .png({ compressionLevel: 6 })
    .toFile(tmpPath);
  renameSync(tmpPath, filePath);
}

/**
 * A long-lived page that boots the app once in agent mode (no audio), then
 * hot-swaps presets via the agent bridge (toil:load_preset) and steps
 * simulation frames manually. Transition mode is forced to 'cut' so swaps
 * are instant instead of a multi-second crossfade.
 */
class RenderSession {
  private page: Awaited<ReturnType<BrowserContext['newPage']>> | null = null;
  rendered = 0;

  constructor(
    private ctx: BrowserContext,
    private devServer: string,
    /**
     * presetId by capture hash, shared across the whole run — different
     * presets must never produce byte-identical captures.
     */
    private seenHashes: Map<string, string>,
    /** All catalog ids, used to pick a sacrificial boot preset. */
    private catalogIds: string[],
    private beatPulse: boolean,
  ) {}

  private async boot(firstTargetId: string) {
    const page = await this.ctx.newPage();
    // The engine only mounts when the route carries a preset (or an audio
    // source), so the boot URL needs ?preset=. But it must NOT be the
    // preset we're about to capture: the stage mounts on a route *change*,
    // and load_preset for the id already in the route is a no-op commit.
    // Boot with any other catalog preset, then swap to the real target.
    const bootId =
      this.catalogIds.find((id) => id !== firstTargetId) ?? firstTargetId;
    // lockQualityStep pins the adaptive-quality controller to the sharpest
    // step — boot cost otherwise degrades it, shrinking the framebuffer.
    await page.goto(
      `${this.devServer}/?preset=${bootId}&agent=true&renderer=webgl&lockQualityStep=0&audio=none`,
      { waitUntil: 'domcontentloaded' },
    );
    // The engine session installs the render hook once the runtime mounts.
    await page.waitForFunction(
      () => typeof window.__STIMS_AGENT_RENDER_FRAMES__ === 'function',
      undefined,
      { timeout: BOOT_TIMEOUT_MS },
    );
    this.page = page;
    return page;
  }

  async close() {
    if (this.page) await this.page.close().catch(() => {});
    this.page = null;
  }

  async render(preset: PresetEntry): Promise<void> {
    const page = this.page ?? (await this.boot(preset.id));

    await page.evaluate((presetId) => {
      window.postMessage({ type: 'toil:load_preset', presetId }, '*');
    }, preset.id);
    // Telemetry's currentPresetId falls back to the *route* id before the
    // engine finishes compiling, so it lies under load. data-active-preset-id
    // is stamped from the engine snapshot and only flips once the preset is
    // actually applied. The stage canvas only sizes once the stage mounts
    // (identicon canvases are 56×56; the stage is viewport-sized).
    await page.waitForFunction(
      (presetId) => {
        const main = document.querySelector('#stims-main');
        if (main?.getAttribute('data-active-preset-id') !== presetId) {
          return false;
        }
        return [...document.querySelectorAll('canvas')].some(
          (c) => c.width >= 400,
        );
      },
      preset.id,
      { timeout: SWAP_TIMEOUT_MS },
    );

    let failure = 'unknown';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const capture = await page.evaluate(
        ({ minFrames, maxFrames, beatPulse }) => {
          const step = window.__STIMS_AGENT_RENDER_FRAMES__;
          if (typeof step !== 'function') {
            return { error: 'render hook missing' };
          }
          // The stage canvas is the largest one — small canvases are
          // identicons and HUD widgets.
          const canvas = [...document.querySelectorAll('canvas')].sort(
            (a, b) => b.width * b.height - a.width * a.height,
          )[0];
          if (!canvas || canvas.width < 400) {
            return { error: 'stage canvas not available' };
          }
          // Read the GL drawing buffer directly instead of toDataURL on the
          // stage canvas: the composite pass leaves alpha at 0, which
          // toDataURL encodes as a fully transparent (black) PNG. Same JS
          // task as the render, so the buffer is still valid.
          const gl =
            (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
            (canvas.getContext('webgl') as WebGLRenderingContext | null);
          if (!gl) {
            return { error: 'stage canvas has no WebGL context' };
          }
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const px = new Uint8Array(w * h * 4);
          const full = document.createElement('canvas');
          full.width = w;
          full.height = h;
          const fullCtx = full.getContext('2d');
          const small = document.createElement('canvas');
          small.width = 96;
          small.height = 54;
          const smallCtx = small.getContext('2d');
          if (!fullCtx || !smallCtx) {
            return { error: '2d context unavailable' };
          }

          const snapshot = () => {
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
            const image = fullCtx.createImageData(w, h);
            // GL rows are bottom-up; ImageData is top-down. Opaque alpha —
            // the renderer's alpha channel is an internal scratch value.
            for (let y = 0; y < h; y++) {
              image.data.set(
                px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4),
                y * w * 4,
              );
            }
            for (let i = 3; i < image.data.length; i += 4) {
              image.data[i] = 255;
            }
            fullCtx.putImageData(image, 0, 0);
            smallCtx.drawImage(full, 0, 0, 96, 54);
            const d = smallCtx.getImageData(0, 0, 96, 54).data;
            let sum = 0;
            let sumSq = 0;
            let max = 0;
            for (let i = 0; i < d.length; i += 4) {
              const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
              sum += l;
              sumSq += l * l;
              if (l > max) max = l;
            }
            const mean = sum / (96 * 54);
            const std = Math.sqrt(Math.max(0, sumSq / (96 * 54) - mean * mean));
            return { mean, max, std };
          };

          // A good preview frame has visible structure and isn't blown out.
          // Feedback presets go black → structured → saturated white as sim
          // time accumulates, so capture the first good checkpoint and keep
          // the best-scoring frame as a fallback. Thresholds mirror the
          // authoritative badFrameReason() checks on the Node side.
          const isGood = (s: { mean: number; max: number; std: number }) =>
            s.max >= 32 && s.mean >= 0.4 && s.mean <= 240 && s.std >= 2.5;
          const score = (s: { mean: number; max: number; std: number }) =>
            (s.max >= 32 && s.mean >= 0.4 ? 2 : 0) +
            (s.mean <= 240 ? 1 : 0) +
            (s.std >= 2.5 ? 2 : 0) +
            Math.min(s.std, 50) / 100;

          let rendered = 0;
          const pump = (n: number) => {
            const result = step({ frames: n, beatPulse });
            if (!result) return false;
            rendered += result.rendered;
            return true;
          };
          if (!pump(minFrames)) {
            return { error: 'render hook returned null (audio active?)' };
          }
          let best: {
            score: number;
            dataUrl: string;
            framesUsed: number;
          } | null = null;
          for (;;) {
            const s = snapshot();
            const sc = score(s);
            if (!best || sc > best.score) {
              best = {
                score: sc,
                dataUrl: full.toDataURL('image/png'),
                framesUsed: rendered,
              };
            }
            if (isGood(s) || rendered >= maxFrames) break;
            // Sample finely while saturation risk is highest, then coarsen.
            const stride = rendered < 60 ? 15 : rendered < 120 ? 30 : 60;
            if (!pump(stride)) {
              return { error: 'render hook returned null (audio active?)' };
            }
          }
          return {
            dataUrl: best.dataUrl,
            rendered,
            framesUsed: best.framesUsed,
          };
        },
        {
          minFrames: MIN_FRAMES,
          maxFrames: MAX_FRAMES,
          beatPulse: this.beatPulse,
        },
      );

      if ('error' in capture) {
        throw new Error(capture.error);
      }

      const buffer = Buffer.from(
        capture.dataUrl.slice('data:image/png;base64,'.length),
        'base64',
      );
      const stats = await analyzeFrame(buffer);

      const badReason = badFrameReason(stats);
      if (badReason) {
        // No retry for black/flat: the page already checkpointed the full
        // frame budget and kept its best frame — more of the same signal
        // yields the same verdict, and retries dominate wall-clock on
        // dark-preset-heavy stretches. Duplicates DO retry (below): they
        // signal a swap race, which more sim time can resolve.
        failure = badReason;
        break;
      } else {
        const collidesWith = this.seenHashes.get(stats.hash);
        if (collidesWith && collidesWith !== preset.id) {
          // Identical pixels to another preset's capture — the canvas did
          // not actually advance to this preset.
          failure = `duplicate of ${collidesWith}`;
        } else {
          this.seenHashes.set(stats.hash, preset.id);
          await writePreview(buffer, join(OUTPUT_DIR, `${preset.id}.png`));
          this.rendered++;
          return;
        }
      }
    }

    this.rendered++;
    throw new Error(failure);
  }
}

async function worker(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  id: number,
  queue: PresetEntry[],
  counters: { success: number; fail: number; done: number },
  failures: CaptureFailure[],
  total: number,
  devServer: string,
  seenHashes: Map<string, string>,
  catalogIds: string[],
  beatPulse: boolean,
) {
  let ctx: BrowserContext | null = null;
  let session: RenderSession | null = null;

  while (queue.length > 0) {
    const preset = queue.shift();
    if (!preset) break;

    const t0 = Date.now();
    try {
      if (!ctx) {
        ctx = await browser.newContext({
          viewport: { ...CAPTURE_VIEWPORT },
          deviceScaleFactor: 1,
        });
        await ctx.addInitScript(() => {
          localStorage.setItem('stims:quality-preset', 'high');
          // Instant preset cuts — a blend crossfade would contaminate
          // captures with the previous preset. (The WebGL backend itself is
          // forced via ?renderer=webgl in the boot URL.)
          localStorage.setItem(
            'stims:milkdrop:ui',
            JSON.stringify({ transitionMode: 'cut', autoplay: false }),
          );
        });
      }
      if (session && session.rendered >= PAGE_RECYCLE_EVERY) {
        await session.close();
        session = null;
      }
      if (!session)
        session = new RenderSession(
          ctx,
          devServer,
          seenHashes,
          catalogIds,
          beatPulse,
        );

      await Promise.race([
        session.render(preset),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Per-preset timeout')),
            PER_PRESET_TIMEOUT_MS,
          ),
        ),
      ]);
      counters.success++;
      counters.done++;
      const elapsed = (Date.now() - t0) / 1000;
      const pct = ((counters.done / total) * 100).toFixed(0);
      console.log(`  [w${id}][${pct}%] ${preset.id} — ${elapsed.toFixed(1)}s`);
    } catch (err) {
      counters.fail++;
      counters.done++;
      const reason = err instanceof Error ? err.message : String(err);
      failures.push({ presetId: preset.id, reason });
      const elapsed = (Date.now() - t0) / 1000;
      const pct = ((counters.done / total) * 100).toFixed(0);
      console.log(
        `  [w${id}][${pct}%] FAIL ${preset.id} — ${elapsed.toFixed(1)}s: ${reason}`,
      );
      // A failure can mean a wedged page or GL context — rebuild both.
      if (session) {
        await session.close();
        session = null;
      }
      if (ctx) {
        await ctx.close().catch(() => {});
        ctx = null;
      }
    }
  }

  if (session) await session.close();
  if (ctx) await ctx.close().catch(() => {});
}

async function main() {
  const args = parseArgs();
  const presets = await getPresets(args);

  if (presets.length === 0) {
    console.error('No presets to render');
    process.exit(1);
  }

  console.log(`${presets.length} presets to render`);
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const port = args.port ?? DEFAULT_PORT;
  const devServer = `http://localhost:${port}`;
  const server = await ensureDevServer(port);
  const concurrency = Math.min(args.workers ?? DEFAULT_WORKERS, presets.length);
  console.log(`Using ${concurrency} concurrent workers`);

  const browser = await chromium.launch({
    headless: args.headless,
    // Full Chromium (--headless=new), not the headless shell: the shell can
    // only rasterize through SwiftShader, while this renders on the real GPU
    // even headless.
    channel: 'chromium',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      // Headed mode (--no-headless) only: persistent pages stack their
      // windows; without these flags macOS occlusion marks covered windows
      // hidden and preset swaps stall. Frame stepping itself doesn't rely
      // on RAF, so captures stay immune either way. Harmless when headless.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  });
  const startTime = Date.now();
  const counters = { success: 0, fail: 0, done: 0 };
  const failures: CaptureFailure[] = [];
  const seenHashes = new Map<string, string>();

  const queue = [...presets];
  // Full catalog, not just the queue: the sacrificial boot preset must
  // differ from the target even when rendering a single id.
  const catalogData = await Bun.file(
    new URL('../public/milkdrop-presets/catalog.json', import.meta.url),
  ).json();
  const catalogIds = (
    Array.isArray(catalogData.presets) ? catalogData.presets : []
  ).map((p: PresetEntry) => p.id);
  const workers = Array.from({ length: concurrency }, (_, i) =>
    worker(
      browser,
      i,
      queue,
      counters,
      failures,
      presets.length,
      devServer,
      seenHashes,
      catalogIds,
      args.beatPulse ?? false,
    ),
  );
  await Promise.all(workers);

  const totalTime = (Date.now() - startTime) / 1000;
  console.log('');
  console.log('=== Done ===');
  console.log(`Total: ${(totalTime / 60).toFixed(1)}m`);
  console.log(`Success: ${counters.success}  Failed: ${counters.fail}`);
  if (counters.success > 0)
    console.log(`Avg: ${(totalTime / counters.success).toFixed(1)}s/preset`);
  if (failures.length > 0) {
    const reportPath = join(OUTPUT_DIR, '..', 'preview-failures.json');
    writeFileSync(reportPath, JSON.stringify(failures, null, 2));
    console.log(
      `${failures.length} presets failed — no file written; details in ${reportPath}`,
    );
  }

  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
