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
 *   bun run scripts/analyze-preset-flash.ts --governor       # with/without
 *
 * `--governor` measures each preset TWICE from one render pass: the raw
 * timeline, and the timeline as the runtime flash governor
 * (src/js/core/services/flash-governor.ts) would have presented it. That is
 * the only honest way to check the governor against real content -- its unit
 * tests use synthetic full-field strobes, which have none of the texture,
 * localized flicker, or motion that real presets do.
 */

import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { ensureDevServer } from './dev-server.ts';
import { analyzeFlashEvents, type FlashAnalysis } from './flash-analysis.ts';

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
const SWAP_TIMEOUT_MS = 90000;
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
  /** Peak flashes/s the runtime governor would have presented (--governor). */
  governedPeakFlashesPerSecond?: number;
  governedExceedsThreshold?: boolean;
  presetId: string;
  title: string;
  author: string;
  error?: string;
}

function parseArgs(argv: string[]) {
  const governor = argv.includes('--governor');
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
    governor,
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
          async ({
            frames,
            deltaMs,
            warmup,
            cols,
            rows,
            beatPulse,
            SAMPLE_STRIDE,
            useGovernor,
            governorGrid,
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

            // Sampled-pixel grid, fixed across frames so pixel N in one
            // frame is the same screen location in the next.
            const sampleXs: number[] = [];
            const sampleYs: number[] = [];
            const sampleTile: number[] = [];
            for (let ty = 0; ty < rows; ty += 1) {
              for (let tx = 0; tx < cols; tx += 1) {
                const x1 = Math.min(w, tx * tileW + tileW);
                const y1 = Math.min(h, ty * tileH + tileH);
                for (let y = ty * tileH; y < y1; y += SAMPLE_STRIDE) {
                  for (let x = tx * tileW; x < x1; x += SAMPLE_STRIDE) {
                    sampleXs.push(x);
                    sampleYs.push(y);
                    sampleTile.push(ty * cols + tx);
                  }
                }
              }
            }
            const sampleCount = sampleXs.length;
            const tileCount = cols * rows;
            // Even sampling means every tile gets the same denominator.
            const tilePixels = Math.max(1, Math.floor(sampleCount / tileCount));

            // Warm up so feedback presets are measured at steady state.
            step({ frames: warmup, deltaMs, beatPulse });

            // Governed track: the same frames as the viewer would have seen
            // with the runtime governor engaged. Computed alongside the raw
            // track from ONE render pass, so both are measured against
            // identical pixels.
            let governor: {
              sample: (
                t: number,
                tiles: Float32Array,
                c: number,
                r: number,
              ) => { luminanceScale: number };
            } | null = null;
            if (useGovernor) {
              // Vite serves this from the dev server; the specifier is a URL
              // rather than a path tsc can resolve, so it goes through a
              // variable to keep the module graph out of the typecheck.
              const governorModule = '/src/js/core/services/flash-governor.ts';
              const mod = (await import(/* @vite-ignore */ governorModule)) as {
                createFlashGovernor: () => typeof governor;
                RECOMMENDED_GRID: number;
              };
              governor = mod.createFlashGovernor();
              governorGrid = mod.RECOMMENDED_GRID;
            }
            const govTiles = new Float32Array(governorGrid * governorGrid);
            const govTileAcc = new Float64Array(governorGrid * governorGrid);
            const govTileCount = new Float64Array(governorGrid * governorGrid);
            let govScale = 1;
            let prevGovLum: Float64Array | null = null;
            const curGovLum = new Float64Array(sampleCount);
            const govRising: number[][] = [];
            const govFalling: number[][] = [];

            let prevLum: Float64Array | null = null;
            const curLum = new Float64Array(sampleCount);
            // Red-flash channel per PEAT/Harding: value = max(0, R-G-B)*320
            // on 0..1 channels, and a transition only qualifies when it
            // moves to or from a saturated red (R/(R+G+B) >= 0.8).
            let prevRed: Float64Array | null = null;
            let prevRedSat: Uint8Array | null = null;
            const curRed = new Float64Array(sampleCount);
            const curRedSat = new Uint8Array(sampleCount);
            const rising: number[][] = [];
            const falling: number[][] = [];
            const redRising: number[][] = [];
            const redFalling: number[][] = [];
            const frameMeanLuminance: number[] = [];
            const frameMeanDelta: number[] = [];

            for (let f = 0; f < frames; f += 1) {
              step({ frames: 1, deltaMs, beatPulse });
              gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);

              let lumSum = 0;
              for (let i = 0; i < sampleCount; i += 1) {
                const o = (sampleYs[i] * w + sampleXs[i]) * 4;
                const r = px[o];
                const g = px[o + 1];
                const b = px[o + 2];
                const l = 0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b];
                curLum[i] = l;
                lumSum += l;
                curRed[i] = Math.max(0, (r - g - b) / 255) * 320;
                const rgbSum = r + g + b;
                curRedSat[i] = rgbSum > 0 && r / rgbSum >= 0.8 ? 1 : 0;
              }
              frameMeanLuminance.push(lumSum / sampleCount);

              if (governor) {
                // Reduce the sampled pixels to the governor's coarse grid,
                // scaled by the mitigation already in force — the governor
                // must observe what the viewer sees, not the raw frame, or
                // it never registers its own effect.
                govTileAcc.fill(0);
                govTileCount.fill(0);
                // Separate scales per axis: the audit grid is 32x18, not
                // square, so reusing one factor left the bottom half of the
                // governor's grid permanently zero and under-reported the
                // flashing area.
                const gx = governorGrid / cols;
                const gy = governorGrid / rows;
                for (let i = 0; i < sampleCount; i += 1) {
                  const tile = sampleTile[i];
                  const tx = Math.min(
                    governorGrid - 1,
                    Math.floor((tile % cols) * gx),
                  );
                  const ty = Math.min(
                    governorGrid - 1,
                    Math.floor(Math.floor(tile / cols) * gy),
                  );
                  const g = ty * governorGrid + tx;
                  govTileAcc[g] += curLum[i] * govScale;
                  govTileCount[g] += 1;
                }
                for (let g = 0; g < govTiles.length; g += 1) {
                  govTiles[g] =
                    govTileCount[g] > 0 ? govTileAcc[g] / govTileCount[g] : 0;
                }
                govScale = governor.sample(
                  f * deltaMs,
                  govTiles,
                  governorGrid,
                  governorGrid,
                ).luminanceScale;
                for (let i = 0; i < sampleCount; i += 1) {
                  curGovLum[i] = curLum[i] * govScale;
                }
              }

              if (prevLum && prevRed && prevRedSat) {
                // Magnitude is decided per pixel, against the full-scale
                // WCAG threshold, BEFORE any spatial aggregation. Averaging
                // luminance over a tile first would scale each swing down
                // by the flashing region's coverage — on sparse
                // bright-on-black presets that pushed genuine flashes two
                // orders of magnitude under the threshold and reported
                // zero flashes corpus-wide.
                const up = new Array(tileCount).fill(0);
                const down = new Array(tileCount).fill(0);
                const redUp = new Array(tileCount).fill(0);
                const redDown = new Array(tileCount).fill(0);
                let deltaSum = 0;
                for (let i = 0; i < sampleCount; i += 1) {
                  const before = prevLum[i];
                  const after = curLum[i];
                  deltaSum += Math.abs(after - before);
                  if (
                    Math.abs(after - before) >= 0.1 &&
                    Math.min(before, after) < 0.8
                  ) {
                    if (after > before) up[sampleTile[i]] += 1;
                    else down[sampleTile[i]] += 1;
                  }
                  const redBefore = prevRed[i];
                  const redAfter = curRed[i];
                  if (
                    (prevRedSat[i] === 1 || curRedSat[i] === 1) &&
                    Math.abs(redAfter - redBefore) > 20
                  ) {
                    if (redAfter > redBefore) redUp[sampleTile[i]] += 1;
                    else redDown[sampleTile[i]] += 1;
                  }
                }
                if (governor && prevGovLum) {
                  const gUp = new Array(tileCount).fill(0);
                  const gDown = new Array(tileCount).fill(0);
                  for (let i = 0; i < sampleCount; i += 1) {
                    const before = prevGovLum[i];
                    const after = curGovLum[i];
                    if (
                      Math.abs(after - before) >= 0.1 &&
                      Math.min(before, after) < 0.8
                    ) {
                      if (after > before) gUp[sampleTile[i]] += 1;
                      else gDown[sampleTile[i]] += 1;
                    }
                  }
                  govRising.push(gUp);
                  govFalling.push(gDown);
                }
                rising.push(up);
                falling.push(down);
                redRising.push(redUp);
                redFalling.push(redDown);
                frameMeanDelta.push(deltaSum / sampleCount);
              }
              if (governor) {
                prevGovLum = prevGovLum
                  ? prevGovLum
                  : new Float64Array(sampleCount);
                prevGovLum.set(curGovLum);
              }
              prevLum = prevLum ? prevLum : new Float64Array(sampleCount);
              prevLum.set(curLum);
              prevRed = prevRed ? prevRed : new Float64Array(sampleCount);
              prevRed.set(curRed);
              prevRedSat = prevRedSat
                ? prevRedSat
                : new Uint8Array(sampleCount);
              prevRedSat.set(curRedSat);
            }

            return {
              rising,
              falling,
              redRising,
              redFalling,
              govRising,
              govFalling,
              tilePixels,
              frameMeanLuminance,
              frameMeanDelta,
            };
          },
          {
            frames: CAPTURE_FRAMES,
            deltaMs: DELTA_MS,
            warmup: WARMUP_FRAMES,
            cols: TILE_COLS,
            rows: TILE_ROWS,
            beatPulse: args.beatPulse,
            SAMPLE_STRIDE,
            useGovernor: args.governor,
            governorGrid: 16,
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
            peakRedFlashesPerSecond: 0,
            totalRedFlashes: 0,
            exceedsRedThreshold: false,
            motionEnergy: 0,
            luminanceVolatility: 0,
            meanLuminance: 0,
            frameCount: 0,
          });
          continue;
        }

        const cap = captured as {
          rising: number[][];
          falling: number[][];
          redRising: number[][];
          redFalling: number[][];
          govRising: number[][];
          govFalling: number[][];
          tilePixels: number;
          frameMeanLuminance: number[];
          frameMeanDelta: number[];
        };
        const analysis = analyzeFlashEvents({
          rising: cap.rising,
          falling: cap.falling,
          redRising: cap.redRising,
          redFalling: cap.redFalling,
          tilePixels: cap.tilePixels,
          // Grid shape drives WCAG's "25% of any 10 degree visual field"
          // window; without it the area test degrades to whole-screen and
          // silently misses flashes confined to one region.
          cols: TILE_COLS,
          rows: TILE_ROWS,
          deltaMs: DELTA_MS,
          frameMeanLuminance: cap.frameMeanLuminance,
          frameMeanDelta: cap.frameMeanDelta,
        });
        // Same render pass, scored again as the governor would have shown
        // it. Only the general-flash channel: the governor scales luminance,
        // which is not a claim about the red-flash criterion.
        const governed =
          args.governor && cap.govRising.length > 0
            ? analyzeFlashEvents({
                rising: cap.govRising,
                falling: cap.govFalling,
                redRising: cap.redRising,
                redFalling: cap.redFalling,
                tilePixels: cap.tilePixels,
                cols: TILE_COLS,
                rows: TILE_ROWS,
                deltaMs: DELTA_MS,
                frameMeanLuminance: cap.frameMeanLuminance,
                frameMeanDelta: cap.frameMeanDelta,
              })
            : null;

        reports.push({
          presetId: preset.id,
          title: preset.title ?? preset.id,
          author: preset.author ?? '',
          ...analysis,
          ...(governed
            ? {
                governedPeakFlashesPerSecond: governed.peakFlashesPerSecond,
                governedExceedsThreshold: governed.exceedsThreshold,
              }
            : {}),
        });
        console.log(
          `${label} — peak=${analysis.peakFlashesPerSecond}/s ` +
            (governed ? `governed=${governed.peakFlashesPerSecond}/s ` : '') +
            `red=${analysis.peakRedFlashesPerSecond}/s ` +
            `motion=${analysis.motionEnergy.toFixed(4)} ` +
            `vol=${analysis.luminanceVolatility.toFixed(4)}` +
            (analysis.exceedsThreshold || analysis.exceedsRedThreshold
              ? '  ** OVER THRESHOLD **'
              : ''),
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
          peakRedFlashesPerSecond: 0,
          totalRedFlashes: 0,
          exceedsRedThreshold: false,
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
  const over = ok.filter((r) => r.exceedsThreshold || r.exceedsRedThreshold);
  const overRed = ok.filter((r) => r.exceedsRedThreshold);
  const peaks = ok.map((r) => r.peakFlashesPerSecond).sort((a, b) => a - b);
  const pct = (p: number) => peaks[Math.floor((peaks.length - 1) * p)] ?? 0;

  const summary = {
    generatedFrom: `${ok.length} analysed / ${reports.length} attempted`,
    beatPulse: args.beatPulse,
    framesPerPreset: CAPTURE_FRAMES,
    overThresholdCount: over.length,
    overThresholdShare: ok.length ? over.length / ok.length : 0,
    overRedThresholdCount: overRed.length,
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
