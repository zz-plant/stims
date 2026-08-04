/**
 * Batch preview generator — renders presets via Playwright + WebGL.
 * Concurrent worker pool with black-frame detection and retry.
 *
 * Usage:
 *   bun run scripts/generate-thumbnails.ts              # missing previews (up to --limit)
 *   bun run scripts/generate-thumbnails.ts --count=100  # first N missing
 *   bun run scripts/generate-thumbnails.ts --ids=geiss-casino,flexi-dawn
 *   bun run scripts/generate-thumbnails.ts --all         # all presets
 *   bun run scripts/generate-thumbnails.ts --force       # overwrite existing
 *   bun run scripts/generate-thumbnails.ts --workers=8   # concurrency
 *
 * Requires: Playwright Chromium installed. Dev server is started automatically.
 * Outputs: public/milkdrop-presets/previews/{presetId}.png (480×270)
 */

import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserContext, chromium } from 'playwright';
import sharp from 'sharp';
import { DEFAULT_VIEWPORT } from '../src/viewport-config.ts';
import { ensureDevServer } from './dev-server.ts';

const DEV_SERVER = 'http://localhost:5173';
const OUTPUT_DIR = 'public/milkdrop-presets/previews';
const PREVIEW_W = 480;
const PREVIEW_H = 270;
const INIT_TIMEOUT = 30000;
const DEFAULT_LIMIT = 50;
const DEFAULT_WORKERS = 6;
const MIN_RENDER_MS = 1500;
const RETRY_WAIT_MS = 1500;
const MAX_RETRIES = 2;
const PER_PRESET_TIMEOUT_MS = 45000;

interface PresetEntry {
  id: string;
  title: string;
  preview?: unknown;
}

function parseArgs() {
  const args: {
    count?: number;
    ids?: string[];
    all?: boolean;
    force?: boolean;
    headless?: boolean;
    workers?: number;
  } = { headless: false };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--count=')) args.count = parseInt(arg.slice(8), 10);
    if (arg.startsWith('--ids=')) args.ids = arg.slice(6).split(',');
    if (arg === '--all') args.all = true;
    if (arg === '--force') args.force = true;
    if (arg.startsWith('--workers='))
      args.workers = parseInt(arg.slice(10), 10);
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

async function isBlackFrame(buffer: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buffer)
    .resize(64, 36)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let nonBlack = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] > 20 || (data[i + 1] ?? 0) > 20 || (data[i + 2] ?? 0) > 20)
      nonBlack++;
  }
  return nonBlack / (info.width * info.height) < 0.005;
}

async function downscaleToPreview(
  buffer: Buffer,
  filePath: string,
): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await sharp(buffer)
    .resize(PREVIEW_W, PREVIEW_H, { fit: 'cover', position: 'center' })
    .png({ compressionLevel: 6 })
    .toFile(tmpPath);
  renameSync(tmpPath, filePath);
}

async function renderPreset(
  ctx: BrowserContext,
  preset: PresetEntry,
): Promise<{ black: boolean }> {
  const page = await ctx.newPage();
  try {
    await page.goto(
      `${DEV_SERVER}/?preset=${preset.id}&audio=demo&agent=true`,
      {
        waitUntil: 'domcontentloaded',
      },
    );
    await page.waitForSelector('#stims-main', { timeout: 10000 });

    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const demo = btns.find(
        (b) =>
          b.textContent?.includes('demo audio') ||
          b.textContent?.includes('Play with demo'),
      );
      demo?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await page.waitForSelector('[data-mode="live"]', {
      timeout: INIT_TIMEOUT,
    });

    await page.evaluate(() => {
      document.querySelectorAll('audio').forEach((a) => {
        a.volume = 0;
      });
    });
    await page.waitForTimeout(MIN_RENDER_MS);

    const canvas = await page.$('canvas');
    if (!canvas) throw new Error('No canvas');

    let black = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const buffer = (await canvas.screenshot({ type: 'png' })) as Buffer;
      black = await isBlackFrame(buffer);
      if (!black || attempt === MAX_RETRIES) {
        const filePath = join(OUTPUT_DIR, `${preset.id}.png`);
        await downscaleToPreview(buffer, filePath);
        return { black };
      }
      await page.waitForTimeout(RETRY_WAIT_MS);
    }

    return { black: true };
  } finally {
    await page.close();
  }
}

async function worker(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  id: number,
  queue: PresetEntry[],
  counters: { success: number; fail: number; black: number; done: number },
  total: number,
) {
  let ctx: BrowserContext | null = null;

  while (queue.length > 0) {
    const preset = queue.shift();
    if (!preset) break;

    const t0 = Date.now();
    try {
      if (!ctx) {
        ctx = await browser.newContext({
          viewport: { ...DEFAULT_VIEWPORT },
        });
        await ctx.addInitScript(() => {
          localStorage.setItem('stims:quality-preset', 'ultra');
          localStorage.setItem('stims:renderer-preference', 'webgl');
        });
      }

      const result = await Promise.race([
        renderPreset(ctx, preset),
        new Promise<{ black: boolean }>((_, reject) =>
          setTimeout(
            () => reject(new Error('Per-preset timeout')),
            PER_PRESET_TIMEOUT_MS,
          ),
        ),
      ]);
      const { black } = result;
      counters.success++;
      if (black) counters.black++;
      const elapsed = (Date.now() - t0) / 1000;
      counters.done++;
      const tag = black ? ' [BLACK]' : '';
      const pct = ((counters.done / total) * 100).toFixed(0);
      console.log(
        `  [w${id}][${pct}%] ${preset.id} — ${elapsed.toFixed(1)}s${tag}`,
      );
    } catch (err) {
      counters.fail++;
      counters.done++;
      const elapsed = (Date.now() - t0) / 1000;
      const pct = ((counters.done / total) * 100).toFixed(0);
      console.log(
        `  [w${id}][${pct}%] FAIL ${preset.id} — ${elapsed.toFixed(1)}s: ${err instanceof Error ? err.message : err}`,
      );
      if (ctx) {
        await ctx.close().catch(() => {});
        ctx = null;
      }
    }
  }

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

  const server = await ensureDevServer();
  const concurrency = Math.min(args.workers ?? DEFAULT_WORKERS, presets.length);
  console.log(`Using ${concurrency} concurrent workers`);

  const browser = await chromium.launch({
    headless: args.headless,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
    ],
  });
  const startTime = Date.now();
  const counters = { success: 0, fail: 0, black: 0, done: 0 };

  const queue = [...presets];
  const workers = Array.from({ length: concurrency }, (_, i) =>
    worker(browser, i, queue, counters, presets.length),
  );
  await Promise.all(workers);

  const totalTime = (Date.now() - startTime) / 1000;
  console.log('');
  console.log('=== Done ===');
  console.log(`Total: ${(totalTime / 60).toFixed(1)}m`);
  console.log(
    `Success: ${counters.success}  Failed: ${counters.fail}  Black: ${counters.black}`,
  );
  if (counters.success > 0)
    console.log(`Avg: ${(totalTime / counters.success).toFixed(1)}s/preset`);
  if (counters.black > 0)
    console.log(
      `${counters.black} black frames — re-run with --ids=<id> --force to retry those`,
    );

  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
