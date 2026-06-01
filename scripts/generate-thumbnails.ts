/**
 * Batch thumbnail generator — renders presets headlessly via Playwright + WebGL.
 * Stays on a single page across all presets (no bundle reload between captures).
 *
 * Usage:
 *   bun run scripts/generate-thumbnails.ts           # all presets
 *   bun run scripts/generate-thumbnails.ts --count=5 # first N
 *   bun run scripts/generate-thumbnails.ts --ids=geiss-casino,flexi-dawn
 *
 * Requires: dev server running (bun run dev) and Playwright Chromium installed.
 * Outputs: thumbnails/{presetId}.png
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const DEV_SERVER = 'http://localhost:5173';
const OUTPUT_DIR = 'thumbnails';
const THUMBNAIL_W = 480;
const THUMBNAIL_H = 270;

interface PresetEntry {
  id: string;
  title: string;
}

function parseArgs(): { count?: number; ids?: string[] } {
  const args: { count?: number; ids?: string[] } = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--count=')) args.count = parseInt(arg.slice(8));
    if (arg.startsWith('--ids=')) args.ids = arg.slice(6).split(',');
  }
  return args;
}

async function getPresets(
  filter: { count?: number; ids?: string[] },
): Promise<PresetEntry[]> {
  const catalogPath = new URL(
    '../public/milkdrop-presets/catalog.json',
    import.meta.url,
  );
  const data = await Bun.file(catalogPath).json();
  const all: PresetEntry[] = data.presets || [];

  if (filter.ids) {
    const idSet = new Set(filter.ids);
    return all.filter((p) => idSet.has(p.id));
  }

  // biome-ignore lint/suspicious/noExplicitAny: catalog data shape varies
  return (all as any[]).filter((p: any) => p.preview).slice(0, filter.count) as PresetEntry[];
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

  // Verify dev server
  try {
    await fetch(DEV_SERVER);
  } catch {
    console.error(`Dev server not running. Start: bun run dev`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 800, height: 600 },
  });

  console.log('Opening app...');
  await page.goto(`${DEV_SERVER}/?agent=true&embedded=true`, {
    waitUntil: 'domcontentloaded',
  });

  // Wait for the React app + engine to mount
  await page.waitForSelector('#stims-main', { timeout: 15000 });
  console.log('App loaded. Mounting engine...');

  // Mount engine by triggering demo audio (this calls ensureEngineMounted internally)
  await page.evaluate(() => {
    const btn = document.querySelector(
      '#use-demo-audio,[data-demo-audio-btn]',
    ) as HTMLButtonElement | null;
    btn?.click();
  });

  // Wait for canvas to appear (engine is mounted and rendering)
  await page.waitForSelector('canvas', { timeout: 30000 });
  console.log('Engine mounted. Starting captures...\n');

  const startTime = Date.now();
  let success = 0;
  let fail = 0;

  for (let i = 0; i < presets.length; i++) {
    const preset = presets[i];
    const t0 = Date.now();

    try {
      // Load preset via URL + popstate event to trigger React route sync
      const loaded = await page.evaluate(
        async (presetId) => {
          const url = new URL(window.location.href);
          url.searchParams.set('preset', presetId);
          window.history.pushState({}, '', url.toString());
          window.dispatchEvent(new PopStateEvent('popstate'));

          // Wait for canvas to have content (preset loaded + frame rendered)
          return new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => resolve(false), 15000);
            let checks = 0;
            const interval = setInterval(() => {
              const canvas = document.querySelector('canvas');
              if (canvas && canvas.width > 0) {
                checks++;
                if (checks >= 20) {
                  clearTimeout(timeout);
                  clearInterval(interval);
                  resolve(true);
                }
              }
            }, 100);
          });
        },
        preset.id,
      );

      if (loaded) {
        // Capture the canvas
        const canvas = await page.$('canvas');
        if (canvas) {
          await canvas.screenshot({
            path: `${OUTPUT_DIR}/${preset.id}.png`,
            type: 'png',
          });
        }

        const elapsed = (Date.now() - t0) / 1000;
        success++;
        const pct = (((i + 1) / presets.length) * 100).toFixed(0);
        console.log(`  [${pct}%] ${preset.id} — ${elapsed.toFixed(1)}s`);
      } else {
        throw new Error('Preset load timeout');
      }
    } catch (err) {
      fail++;
      const elapsed = (Date.now() - t0) / 1000;
      console.log(`  [FAIL] ${preset.id} — ${elapsed.toFixed(1)}s: ${err}`);
    }

    // Progress estimate
    if (i === 4 && presets.length > 5) {
      const avgMs = (Date.now() - startTime) / (i + 1);
      const remaining = (presets.length - i - 1) * avgMs;
      console.log(
        `  ... ~${(remaining / 60000).toFixed(0)}m remaining for ${presets.length - i - 1} presets\n`,
      );
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log('');
  console.log(`=== Done ===`);
  console.log(`Total: ${(totalTime / 60).toFixed(1)}m`);
  console.log(`Success: ${success}  Failed: ${fail}`);
  console.log(
    `Avg: ${(totalTime / Math.max(1, success)).toFixed(1)}s/preset`,
  );

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
