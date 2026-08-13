/**
 * Photosensitive-risk audit across the preset corpus.
 *
 * Renders each preset on a deterministic simulated timeline (the engine's
 * agent hook, not wall clock), reads the GL drawing buffer per frame,
 * reduces it to a tile grid of WCAG relative luminance, and runs the
 * flash-threshold analysis in flash-analysis.ts.
 *
 * Determinism matters twice over here: the frame delta is exact, so
 * "flashes per second" is a real rate rather than an artifact of machine
 * load, and the audio signal is the engine's synthetic preview waveform
 * (optionally with beat pulses), so every preset is measured under an
 * identical stimulus instead of whatever song happened to be playing.
 *
 * This flags presets for review. It is not a medical determination, and a
 * preset under threshold here is not thereby certified safe for anyone.
 *
 * Usage:
 *   bun run scripts/analyze-preset-flash.ts                 # 50-preset sample
 *   bun run scripts/analyze-preset-flash.ts --count=200
 *   bun run scripts/analyze-preset-flash.ts --all
 *   bun run scripts/analyze-preset-flash.ts --ids=a,b,c
 *   bun run scripts/analyze-preset-flash.ts --beat-pulse    # with kick transients
 *   bun run scripts/analyze-preset-flash.ts --out=report.json
 */

import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { ensureDevServer } from './dev-server.ts';
import { analyzeFlashTimeline, type FlashAnalysis } from './flash-analysis.ts';

const DEFAULT_COUNT = 50;
const DEFAULT_PORT = 5199;
const DEFAULT_OUT = 'flash-audit.json';
// 5 seconds of simulated 60fps timeline. Long enough for a 1s sliding
// window to have somewhere to slide; short enough to audit at scale.
const CAPTURE_FRAMES = 300;
const DELTA_MS = 1000 / 60;
// Feedback presets accumulate structure over time; measuring from frame 0
// would score the warm-up ramp rather than the preset's steady behavior.
const WARMUP_FRAMES = 90;
const TILE_COLS = 32;
const TILE_ROWS = 18;
// Pixel stride when averaging within a tile. 3 keeps ~1/9 of pixels —
// enough to catch sparse bright structures a centre sample misses,
// without making a 300-frame capture quadratically expensive.
const SAMPLE_STRIDE = 3;
const BOOT_TIMEOUT_MS = 45000;
const SWAP_TIMEOUT_MS = 45000;
const VIEWPORT = { width: 960, height: 540 };
// Each preset compiles shaders and allocates feedback targets; hundreds of
// swaps in one context eventually exhausts GPU resources and kills the
// page. generate-thumbnails.ts hits the same wall and recycles every 100 —
// this pass reads back 300 full framebuffers per preset, so it recycles
// far more aggressively.
const PAGE_RECYCLE_EVERY = 20;

interface PresetEntry {
  id: string;
  title?: string;
  author?: string;
}

export interface PresetFlashReport extends FlashAnalysis {
  presetId: string;
  title: string;
  author: string;
  error?: string;
}

function parseArgs(argv: string[]) {
  const get = (flag: string) =>
    argv
      .find((a) => a.startsWith(`--${flag}=`))
      ?.split('=')
      .slice(1)
      .join('=');
  return {
    count: Number(get('count') ?? DEFAULT_COUNT),
    all: argv.includes('--all'),
    ids:
      get('ids')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? null,
    beatPulse: argv.includes('--beat-pulse'),
    port: Number(get('port') ?? DEFAULT_PORT),
    out: get('out') ?? DEFAULT_OUT,
    headless: !argv.includes('--no-headless'),
  };
}

/**
 * Evenly-spaced sample across the catalog rather than the first N: the
 * catalog is grouped by author/collection, so a head slice would measure
 * one artist's style and call it a corpus.
 */
function sampleEvenly<T>(items: T[], count: number): T[] {
  if (count >= items.length) return [...items];
  const stride = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * stride)]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const catalogUrl = new URL(
    '../public/milkdrop-presets/catalog.json',
    import.meta.url,
  );
  const raw = JSON.parse(await Bun.file(catalogUrl).text()) as
    | { presets?: PresetEntry[] }
    | PresetEntry[];
  const allPresets: PresetEntry[] = Array.isArray(raw)
    ? raw
    : (raw.presets ?? []);

  const targets = args.ids
    ? allPresets.filter((p) => args.ids?.includes(p.id))
    : args.all
      ? allPresets
      : sampleEvenly(allPresets, args.count);

  console.log(
    `Auditing ${targets.length} of ${allPresets.length} presets ` +
      `(${CAPTURE_FRAMES} frames @ ${DELTA_MS.toFixed(2)}ms, ` +
      `beatPulse=${args.beatPulse})`,
  );

  const devServer = await ensureDevServer(args.port);
  const browser = await chromium.launch({ headless: args.headless });
  const ctx = await browser.newContext({ viewport: VIEWPORT });

  const reports: PresetFlashReport[] = [];
  let page = await ctx.newPage();

  const bootPage = async (avoidId: string) => {
    const bootId = allPresets.find((p) => p.id !== avoidId)?.id;
    await page.goto(
      `http://127.0.0.1:${args.port}/?preset=${bootId}&agent=true&renderer=webgl&lockQualityStep=0`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForFunction(
      () => typeof window.__STIMS_AGENT_RENDER_FRAMES__ === 'function',
      undefined,
      { timeout: BOOT_TIMEOUT_MS },
    );
  };

  const recyclePage = async (avoidId: string) => {
    await page.close().catch(() => {});
    page = await ctx.newPage();
    await bootPage(avoidId);
  };

  try {
    await bootPage(targets[0]?.id ?? '');

    for (const [index, preset] of targets.entries()) {
      const label = `[${index + 1}/${targets.length}] ${preset.id}`;
      if (index > 0 && index % PAGE_RECYCLE_EVERY === 0) {
        await recyclePage(preset.id);
      }
      try {
        await page.evaluate((presetId) => {
          window.postMessage({ type: 'toil:load_preset', presetId }, '*');
        }, preset.id);

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

        const captured = await page.evaluate(
          ({
            frames,
            deltaMs,
            warmup,
            cols,
            rows,
            beatPulse,
            SAMPLE_STRIDE,
          }) => {
            const step = window.__STIMS_AGENT_RENDER_FRAMES__;
            if (typeof step !== 'function') {
              return { error: 'render hook missing' };
            }
            const canvas = [...document.querySelectorAll('canvas')].sort(
              (a, b) => b.width * b.height - a.width * a.height,
            )[0] as HTMLCanvasElement | undefined;
            if (!canvas || canvas.width < 400) {
              return { error: 'stage canvas not available' };
            }
            const gl =
              (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
              (canvas.getContext('webgl') as WebGLRenderingContext | null);
            if (!gl) return { error: 'no WebGL context' };

            // sRGB -> linear, WCAG relative luminance weights. Only 256
            // possible byte values, so the transfer function is tabulated
            // once instead of running ~72M pow() calls per preset — that
            // cost, not the GPU readback, is what made per-tile averaging
            // slow enough to be unusable.
            const LUT = new Float64Array(256);
            for (let i = 0; i < 256; i += 1) {
              const c = i / 255;
              LUT[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            }

            const w = gl.drawingBufferWidth;
            const h = gl.drawingBufferHeight;
            const px = new Uint8Array(w * h * 4);
            const tileW = Math.max(1, Math.floor(w / cols));
            const tileH = Math.max(1, Math.floor(h / rows));

            // Warm up so feedback presets are measured at steady state.
            step({ frames: warmup, deltaMs, beatPulse });

            const timeline: number[][] = [];
            for (let f = 0; f < frames; f += 1) {
              step({ frames: 1, deltaMs, beatPulse });
              gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
              const tiles: number[] = [];
              for (let ty = 0; ty < rows; ty += 1) {
                for (let tx = 0; tx < cols; tx += 1) {
                  // Mean over the tile, not its centre pixel. Typical
                  // MilkDrop presets are sparse bright structures on a
                  // near-black field — one measured frame lit only 2.3% of
                  // pixels — so a centre sample lands on background almost
                  // every time and reports "nothing moved" for a preset
                  // that is visibly strobing. WCAG's area test asks whether
                  // a patch of visual field changed luminance, which is a
                  // mean over the patch. Strided to keep 300 frames x 576
                  // tiles tractable while still covering the whole tile.
                  const x0 = tx * tileW;
                  const y0 = ty * tileH;
                  const x1 = Math.min(w, x0 + tileW);
                  const y1 = Math.min(h, y0 + tileH);
                  let acc = 0;
                  let n = 0;
                  for (let y = y0; y < y1; y += SAMPLE_STRIDE) {
                    for (let x = x0; x < x1; x += SAMPLE_STRIDE) {
                      const o = (y * w + x) * 4;
                      acc +=
                        0.2126 * LUT[px[o]] +
                        0.7152 * LUT[px[o + 1]] +
                        0.0722 * LUT[px[o + 2]];
                      n += 1;
                    }
                  }
                  tiles.push(n > 0 ? acc / n : 0);
                }
              }
              timeline.push(tiles);
            }
            return { timeline };
          },
          {
            frames: CAPTURE_FRAMES,
            deltaMs: DELTA_MS,
            warmup: WARMUP_FRAMES,
            cols: TILE_COLS,
            rows: TILE_ROWS,
            beatPulse: args.beatPulse,
            SAMPLE_STRIDE,
          },
        );

        if ('error' in captured && captured.error) {
          console.log(`${label} — SKIP (${captured.error})`);
          reports.push({
            presetId: preset.id,
            title: preset.title ?? preset.id,
            author: preset.author ?? '',
            error: captured.error,
            peakFlashesPerSecond: 0,
            totalFlashes: 0,
            exceedsThreshold: false,
            motionEnergy: 0,
            luminanceVolatility: 0,
            meanLuminance: 0,
            frameCount: 0,
          });
          continue;
        }

        const analysis = analyzeFlashTimeline({
          frames: (captured as { timeline: number[][] }).timeline,
          deltaMs: DELTA_MS,
          // Grid shape drives WCAG's "25% of any 10 degree visual field"
          // window; without it the area test degrades to whole-screen and
          // silently misses flashes confined to one region.
          cols: TILE_COLS,
          rows: TILE_ROWS,
        });
        reports.push({
          presetId: preset.id,
          title: preset.title ?? preset.id,
          author: preset.author ?? '',
          ...analysis,
        });
        console.log(
          `${label} — peak=${analysis.peakFlashesPerSecond}/s ` +
            `motion=${analysis.motionEnergy.toFixed(4)} ` +
            `vol=${analysis.luminanceVolatility.toFixed(4)}` +
            (analysis.exceedsThreshold ? '  ** OVER THRESHOLD **' : ''),
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.log(`${label} — FAIL (${reason.slice(0, 80)})`);
        // A killed page would otherwise fail every remaining preset in
        // the run; bring a fresh one up before continuing.
        if (page.isClosed() || /closed|crash/i.test(reason)) {
          await recyclePage(preset.id).catch(() => {});
        }
        reports.push({
          presetId: preset.id,
          title: preset.title ?? preset.id,
          author: preset.author ?? '',
          error: reason.slice(0, 200),
          peakFlashesPerSecond: 0,
          totalFlashes: 0,
          exceedsThreshold: false,
          motionEnergy: 0,
          luminanceVolatility: 0,
          meanLuminance: 0,
          frameCount: 0,
        });
      }
    }
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    devServer.close();
  }

  const ok = reports.filter((r) => !r.error);
  const over = ok.filter((r) => r.exceedsThreshold);
  const peaks = ok.map((r) => r.peakFlashesPerSecond).sort((a, b) => a - b);
  const pct = (p: number) => peaks[Math.floor((peaks.length - 1) * p)] ?? 0;

  const summary = {
    generatedFrom: `${ok.length} analysed / ${reports.length} attempted`,
    beatPulse: args.beatPulse,
    framesPerPreset: CAPTURE_FRAMES,
    overThresholdCount: over.length,
    overThresholdShare: ok.length ? over.length / ok.length : 0,
    peakFlashesPerSecond: {
      median: pct(0.5),
      p90: pct(0.9),
      p99: pct(0.99),
      max: peaks[peaks.length - 1] ?? 0,
    },
  };

  writeFileSync(args.out, `${JSON.stringify({ summary, reports }, null, 2)}\n`);

  console.log('\n─── summary ───');
  console.log(JSON.stringify(summary, null, 2));
  console.log(
    `\nOver threshold (${over.length}):\n` +
      (over
        .sort((a, b) => b.peakFlashesPerSecond - a.peakFlashesPerSecond)
        .map((r) => `  ${r.peakFlashesPerSecond}/s  ${r.presetId}`)
        .join('\n') || '  (none)'),
  );
  console.log(`\nWrote ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
