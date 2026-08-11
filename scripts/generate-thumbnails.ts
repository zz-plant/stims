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
// 5 simulated seconds at 60fps — enough for feedback-heavy presets to build
// structure. Retries pump additional frames on top of accumulated state.
const WARMUP_FRAMES = 300;
const RETRY_FRAMES = 360;
const MAX_RETRIES = 2;
const BOOT_TIMEOUT_MS = 30000;
const SWAP_TIMEOUT_MS = 30000;
const PER_PRESET_TIMEOUT_MS = 60000;
// Render at output size — toDataURL reads the framebuffer, so there is no
// compositing quality to buy back with supersampling.
const CAPTURE_VIEWPORT = { width: PREVIEW_W, height: PREVIEW_H };
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
};

async function analyzeFrame(buffer: Buffer): Promise<FrameStats> {
  const { data, info } = await sharp(buffer)
    .resize(96, 54)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let max = 0;
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const luma =
      0.299 * data[i] + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
    sum += luma;
    if (luma > max) max = luma;
  }
  return {
    hash: createHash('sha256').update(data).digest('hex'),
    meanLuma: sum / pixels,
    maxLuma: max,
  };
}

/** Near-black noise as well as pure black: both are useless as previews. */
function isBlackFrame(stats: FrameStats): boolean {
  return stats.maxLuma < 16 || stats.meanLuma < 2;
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
  ) {}

  private async boot(firstPresetId: string) {
    const page = await this.ctx.newPage();
    await page.goto(`${this.devServer}/?preset=${firstPresetId}&agent=true`, {
      waitUntil: 'domcontentloaded',
    });
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
    const alreadyBooted = Boolean(this.page);
    const page = this.page ?? (await this.boot(preset.id));

    if (alreadyBooted) {
      await page.evaluate((presetId) => {
        window.postMessage({ type: 'toil:load_preset', presetId }, '*');
      }, preset.id);
      // Telemetry can briefly echo the routed id before the engine actually
      // swaps, so this wait is necessary but not sufficient — the duplicate
      // check below is what proves the canvas really changed.
      await page.waitForFunction(
        (presetId) =>
          window.__STIMS_AGENT_TELEMETRY__?.currentPresetId === presetId,
        preset.id,
        { timeout: SWAP_TIMEOUT_MS },
      );
    }

    let frames = WARMUP_FRAMES;
    let failure = 'unknown';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const capture = await page.evaluate((frameCount) => {
        const step = window.__STIMS_AGENT_RENDER_FRAMES__;
        if (typeof step !== 'function') {
          return { error: 'render hook missing' };
        }
        const result = step({ frames: frameCount });
        if (!result) {
          return { error: 'render hook returned null (audio active?)' };
        }
        const canvas = document.querySelector('canvas');
        if (!canvas) {
          return { error: 'no canvas' };
        }
        return {
          dataUrl: canvas.toDataURL('image/png'),
          rendered: result.rendered,
        };
      }, frames);

      if ('error' in capture) {
        throw new Error(capture.error);
      }

      const buffer = Buffer.from(
        capture.dataUrl.slice('data:image/png;base64,'.length),
        'base64',
      );
      const stats = await analyzeFrame(buffer);

      if (isBlackFrame(stats)) {
        failure = `black frame (mean=${stats.meanLuma.toFixed(1)}, max=${stats.maxLuma.toFixed(0)})`;
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

      frames = RETRY_FRAMES;
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
          localStorage.setItem('stims:renderer-preference', 'webgl');
          // Instant preset cuts — a blend crossfade would contaminate
          // captures with the previous preset.
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
      if (!session) session = new RenderSession(ctx, devServer, seenHashes);

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
