/**
 * Batch thumbnail generator — renders presets via Playwright + WebGL.
 * Fresh browser context per preset for clean GPU state.
 *
 * Usage:
 *   bun run scripts/generate-thumbnails.ts              # all presets with previews
 *   bun run scripts/generate-thumbnails.ts --count=5    # first N
 *   bun run scripts/generate-thumbnails.ts --ids=geiss-casino,flexi-dawn
 *   bun run scripts/generate-thumbnails.ts --all         # all 1,791 presets
 *
 * Requires: dev server running (bun run dev) and Playwright Chromium installed.
 * Outputs: thumbnails/{presetId}.png + thumbnails/{presetId}.thumb.png (480×270)
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const DEV_SERVER = 'http://localhost:5173';
const OUTPUT_DIR = 'thumbnails';
const THUMB_W = 480;
const THUMB_H = 270;
const INIT_TIMEOUT = 30000;

interface PresetEntry {
  id: string;
  title: string;
}

function parseArgs(): { count?: number; ids?: string[]; all?: boolean } {
  const args: { count?: number; ids?: string[]; all?: boolean } = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--count=')) args.count = parseInt(arg.slice(8), 10);
    if (arg.startsWith('--ids=')) args.ids = arg.slice(6).split(',');
    if (arg === '--all') args.all = true;
  }
  return args;
}

async function getPresets(filter: {
  count?: number;
  ids?: string[];
  all?: boolean;
}): Promise<PresetEntry[]> {
  const catalogPath = new URL(
    '../public/milkdrop-presets/catalog.json',
    import.meta.url,
  );
  const data = await Bun.file(catalogPath).json();
  // biome-ignore lint/suspicious/noExplicitAny: catalog data shape varies
  const all: PresetEntry[] = data.presets || [];

  if (filter.ids) {
    const idSet = new Set(filter.ids);
    return all.filter((p) => idSet.has(p.id));
  }

  if (filter.all) return all;

  // biome-ignore lint/suspicious/noExplicitAny: catalog data shape varies
  // biome-ignore lint/suspicious/noExplicitAny: catalog data shape varies
  return (all as any[])
    .filter((p: any) => p.preview)
    .slice(0, filter.count) as PresetEntry[];
}

async function downscaleFull(filePath: string): Promise<string> {
  const thumbPath = filePath.replace(/\.png$/, '.thumb.png');
  await sharp(filePath)
    .resize(THUMB_W, THUMB_H, { fit: 'contain', background: '#000' })
    .png({ quality: 85, compressionLevel: 9 })
    .toFile(thumbPath);
  return thumbPath;
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

  try {
    await fetch(DEV_SERVER);
  } catch {
    console.error('Dev server not running. Start: bun run dev');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const startTime = Date.now();
  let success = 0;
  let fail = 0;

  for (let i = 0; i < presets.length; i++) {
    const preset = presets[i];
    const t0 = Date.now();
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    });
    await ctx.addInitScript(() => {
      localStorage.setItem('stims:quality-preset', 'ultra');
      localStorage.setItem('stims:renderer-preference', 'webgpu');
    });
    const page = await ctx.newPage();

    try {
      await page.goto(`${DEV_SERVER}/?preset=${preset.id}&audio=demo`, {
        waitUntil: 'domcontentloaded',
      });

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
      await page.waitForTimeout(2000);

      const canvas = await page.$('canvas');
      if (!canvas) throw new Error('No canvas');

      const filePath = join(OUTPUT_DIR, `${preset.id}.png`);
      await canvas.screenshot({ path: filePath, type: 'png' });

      const { size } = await Bun.file(filePath).stat();
      if (size < 10000) {
        console.log(`    ${(size / 1024).toFixed(1)}KB — retrying after 5s...`);
        await page.waitForTimeout(5000);
        await canvas.screenshot({ path: filePath, type: 'png' });
      }

      await downscaleFull(filePath);

      success++;
      const elapsed = (Date.now() - t0) / 1000;
      const pct = (((i + 1) / presets.length) * 100).toFixed(0);
      console.log(`  [${pct}%] ${preset.id} — ${elapsed.toFixed(1)}s`);
    } catch (err) {
      fail++;
      const elapsed = (Date.now() - t0) / 1000;
      console.log(`  [FAIL] ${preset.id} — ${elapsed.toFixed(1)}s: ${err}`);
    } finally {
      await page.close();
      await ctx.close();
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log('');
  console.log('=== Done ===');
  console.log(`Total: ${(totalTime / 60).toFixed(1)}m`);
  console.log(`Success: ${success}  Failed: ${fail}`);
  if (success > 0)
    console.log(`Avg: ${(totalTime / success).toFixed(1)}s/preset`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
