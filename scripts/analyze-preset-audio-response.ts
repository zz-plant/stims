/**
 * Audio->visual transfer characterization across a handful of presets.
 *
 * For each preset, drives the deterministic render hook with a sequence of
 * controlled synthetic audio profiles (src/js/core/testing/synthetic-
 * stimulus.ts) instead of the decorative idle wave, reads back the same
 * per-frame "mean absolute luminance delta" response signal
 * analyze-preset-flash.ts uses for motion energy, and runs the pure math in
 * audio-visual-transfer.ts to estimate:
 *
 *   - responsiveness: correlation between a full-spectrum ramp and the
 *     visual response (does magnitude track driving energy at all).
 *   - latency: frames between an isolated transient and the visual peak.
 *   - persistence: frames for the visual response to decay back toward its
 *     pre-transient baseline after the transient ends.
 *   - autonomy: how much the visual output still moves under a *held
 *     constant* stimulus — feedback accumulation or internal timers, not
 *     audio.
 *   - selectivity: whether a bass-only ramp and a treble-only ramp produce
 *     different responsiveness for the same preset.
 *
 * With `--lock`, each preset is additionally measured under a *relationship
 * lock* (renderFrames({ relationshipLock: true })): the preset-facing
 * time/frame clock is pinned while audio keeps driving. This is the
 * machine-level version of the Layer 2 Q1 comparison in
 * docs/SENSORY_ACCESSIBILITY.md — does pinning the mapping suppress autonomy
 * while preserving responsiveness?
 *
 * Each preset is reloaded fresh before every trial, deliberately paying the
 * extra reload cost rather than letting one trial's feedback-accumulated
 * state bleed into the next — a controlled experiment needs independent
 * trials, and the existing analyze-preset-flash.ts pattern already accepts
 * per-preset reload cost for the same reason.
 *
 * This is exploratory measurement for the Layer 1 research program in
 * docs/SENSORY_ACCESSIBILITY.md, not a certified property of any preset —
 * the response metric is one reducer over rendered pixels under a synthetic
 * signal, not a model of how the preset behaves under real music.
 *
 * Usage:
 *   bun run scripts/analyze-preset-audio-response.ts                  # 5-preset sample
 *   bun run scripts/analyze-preset-audio-response.ts --count=20
 *   bun run scripts/analyze-preset-audio-response.ts --ids=a,b,c
 *   bun run scripts/analyze-preset-audio-response.ts --lock           # + locked trials
 *   bun run scripts/analyze-preset-audio-response.ts --out=report.json
 */

import { writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import type { StimulusSpec } from '../src/js/core/testing/synthetic-stimulus.ts';
import {
  autonomyVariance,
  crossCorrelationLag,
  decayPersistenceFrames,
  pearsonCorrelation,
} from './audio-visual-transfer.ts';
import { ensureDevServer } from './dev-server.ts';

const DEFAULT_COUNT = 5;
const DEFAULT_PORT = 5198; // distinct from analyze-preset-flash.ts's 5199
const DEFAULT_OUT = 'audio-response-report.json';
const DELTA_MS = 1000 / 60;
const WARMUP_FRAMES = 90;
const RAMP_FRAMES = 180;
const TRANSIENT_FRAMES = 200;
const TRANSIENT_AT = 100;
const TRANSIENT_WIDTH = 20;
const FLAT_FRAMES = 120;
const BAND_FRAMES = 180;
const MAX_LAG_FRAMES = 40;
const SAMPLE_STRIDE = 4;
const BOOT_TIMEOUT_MS = 45000;
const SWAP_TIMEOUT_MS = 90000;
const VIEWPORT = { width: 960, height: 540 };

interface PresetEntry {
  id: string;
  title?: string;
  author?: string;
}

interface CaptureResult {
  responseSeries?: number[];
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
    ids:
      get('ids')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? null,
    port: Number(get('port') ?? DEFAULT_PORT),
    out: get('out') ?? DEFAULT_OUT,
    headless: !argv.includes('--no-headless'),
    lock: argv.includes('--lock'),
  };
}

function sampleEvenly<T>(items: T[], count: number): T[] {
  if (count >= items.length) return [...items];
  const stride = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * stride)]);
}

/**
 * Renders `frames` frames one at a time under `spec`, reading back the
 * stage canvas after each and reducing it to a single "mean absolute
 * per-pixel luminance delta" scalar — the same magnitude-of-change metric
 * analyze-preset-flash.ts calls motion energy. Deliberately whole-frame
 * rather than tiled: transfer characterization has no spatial-area
 * criterion to satisfy, only "how much did the image change."
 */
async function captureResponse(
  page: Page,
  frames: number,
  spec: StimulusSpec,
  lock = false,
): Promise<CaptureResult> {
  return page.evaluate(
    ({ frames, deltaMs, warmup, spec, SAMPLE_STRIDE, relationshipLock }) => {
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

      const LUT = new Float64Array(256);
      for (let i = 0; i < 256; i += 1) {
        const c = i / 255;
        LUT[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }

      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      const sampleXs: number[] = [];
      const sampleYs: number[] = [];
      for (let y = 0; y < h; y += SAMPLE_STRIDE) {
        for (let x = 0; x < w; x += SAMPLE_STRIDE) {
          sampleXs.push(x);
          sampleYs.push(y);
        }
      }
      const sampleCount = sampleXs.length;

      // Neutral warmup — no stimulus — so feedback presets reach steady
      // state before the trial's own signal starts, matching
      // analyze-preset-flash.ts's warmup convention.
      step({ frames: warmup, deltaMs });

      let prevLum: Float64Array | null = null;
      const curLum = new Float64Array(sampleCount);
      const responseSeries: number[] = [];

      for (let f = 0; f < frames; f += 1) {
        step({
          frames: 1,
          deltaMs,
          stimulus: { spec, frameOffset: f, totalFrames: frames },
          relationshipLock,
        });
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);

        for (let i = 0; i < sampleCount; i += 1) {
          const o = (sampleYs[i] * w + sampleXs[i]) * 4;
          curLum[i] =
            0.2126 * LUT[px[o]] +
            0.7152 * LUT[px[o + 1]] +
            0.0722 * LUT[px[o + 2]];
        }

        if (prevLum) {
          let deltaSum = 0;
          for (let i = 0; i < sampleCount; i += 1) {
            deltaSum += Math.abs(curLum[i] - prevLum[i]);
          }
          responseSeries.push(deltaSum / sampleCount);
        } else {
          responseSeries.push(0);
        }
        prevLum = prevLum ?? new Float64Array(sampleCount);
        prevLum.set(curLum);
      }

      return { responseSeries };
    },
    {
      frames,
      deltaMs: DELTA_MS,
      warmup: WARMUP_FRAMES,
      spec,
      SAMPLE_STRIDE,
      relationshipLock: lock,
    },
  );
}

interface PresetTransferReport {
  presetId: string;
  title: string;
  author: string;
  error?: string;
  responsiveness?: number;
  latencyFrames?: number;
  latencyCorrelation?: number;
  persistenceFrames?: number | null;
  autonomy?: number;
  bassResponsiveness?: number;
  trebleResponsiveness?: number;
  selectivity?: number;
  /** Responsiveness with the relationship clock pinned (--lock). */
  responsivenessLocked?: number;
  /** Autonomy with the relationship clock pinned (--lock). */
  autonomyLocked?: number;
}

async function loadPreset(page: Page, presetId: string) {
  await page.evaluate((id) => {
    window.postMessage({ type: 'toil:load_preset', presetId: id }, '*');
  }, presetId);
  await page.waitForFunction(
    (id) => {
      const main = document.querySelector('#stims-main');
      if (main?.getAttribute('data-active-preset-id') !== id) return false;
      return [...document.querySelectorAll('canvas')].some(
        (c) => c.width >= 400,
      );
    },
    presetId,
    { timeout: SWAP_TIMEOUT_MS },
  );
}

async function analyzePreset(
  page: Page,
  preset: PresetEntry,
  lock = false,
): Promise<PresetTransferReport> {
  const base: PresetTransferReport = {
    presetId: preset.id,
    title: preset.title ?? preset.id,
    author: preset.author ?? '',
  };

  // Trial 1: full-spectrum ramp -> responsiveness.
  await loadPreset(page, preset.id);
  const rampSpec: StimulusSpec = { type: 'ramp', from: 0.05, to: 1 };
  const ramp = await captureResponse(page, RAMP_FRAMES, rampSpec);
  if (ramp.error || !ramp.responseSeries) return { ...base, error: ramp.error };
  const rampGround = Array.from(
    { length: RAMP_FRAMES },
    (_, i) =>
      rampSpec.from + (rampSpec.to - rampSpec.from) * (i / (RAMP_FRAMES - 1)),
  );
  const responsiveness = pearsonCorrelation(rampGround, ramp.responseSeries);

  // Trial 2: isolated transient -> latency + persistence.
  await loadPreset(page, preset.id);
  const transientSpec: StimulusSpec = {
    type: 'transient',
    atFrame: TRANSIENT_AT,
    widthFrames: TRANSIENT_WIDTH,
    magnitude: 1,
    baseline: 0.1,
  };
  const transient = await captureResponse(
    page,
    TRANSIENT_FRAMES,
    transientSpec,
  );
  let latencyFrames: number | undefined;
  let latencyCorrelation: number | undefined;
  let persistenceFrames: number | null | undefined;
  if (!transient.error && transient.responseSeries) {
    const transientGround = Array.from({ length: TRANSIENT_FRAMES }, (_, i) => {
      const distance = Math.abs(i - TRANSIENT_AT);
      if (distance > TRANSIENT_WIDTH) return 0.1;
      return (
        0.1 +
        0.9 * (0.5 * (1 + Math.cos((Math.PI * distance) / TRANSIENT_WIDTH)))
      );
    });
    const lag = crossCorrelationLag(
      transientGround,
      transient.responseSeries,
      MAX_LAG_FRAMES,
    );
    latencyFrames = lag.lagFrames;
    latencyCorrelation = lag.correlation;
    const preBaseline =
      transient.responseSeries
        .slice(0, Math.max(1, TRANSIENT_AT - TRANSIENT_WIDTH))
        .reduce((a, b) => a + b, 0) /
      Math.max(1, TRANSIENT_AT - TRANSIENT_WIDTH);
    persistenceFrames = decayPersistenceFrames(
      transient.responseSeries,
      TRANSIENT_AT,
      preBaseline,
      0.15,
    );
  }

  // Trial 3: held-constant stimulus -> autonomy.
  await loadPreset(page, preset.id);
  const flat = await captureResponse(page, FLAT_FRAMES, {
    type: 'flat',
    level: 0.4,
  });
  const autonomy =
    !flat.error && flat.responseSeries
      ? autonomyVariance(flat.responseSeries)
      : undefined;

  // Trials 4/5: bass-only vs. treble-only ramp -> selectivity.
  await loadPreset(page, preset.id);
  const bassSpec: StimulusSpec = {
    type: 'band',
    band: 'bass',
    from: 0.05,
    to: 1,
  };
  const bass = await captureResponse(page, BAND_FRAMES, bassSpec);
  await loadPreset(page, preset.id);
  const trebleSpec: StimulusSpec = {
    type: 'band',
    band: 'treble',
    from: 0.05,
    to: 1,
  };
  const treble = await captureResponse(page, BAND_FRAMES, trebleSpec);
  const bandGround = Array.from(
    { length: BAND_FRAMES },
    (_, i) => 0.05 + 0.95 * (i / (BAND_FRAMES - 1)),
  );
  const bassResponsiveness =
    !bass.error && bass.responseSeries
      ? pearsonCorrelation(bandGround, bass.responseSeries)
      : undefined;
  const trebleResponsiveness =
    !treble.error && treble.responseSeries
      ? pearsonCorrelation(bandGround, treble.responseSeries)
      : undefined;

  // Trials 6/7 (--lock only): the same ramp and flat trials with the
  // relationship clock pinned. responsivenessLocked asks whether audio still
  // drives output when time/frame stop; autonomyLocked asks how much residual
  // motion is left when the clock is the only thing suppressed.
  let responsivenessLocked: number | undefined;
  let autonomyLocked: number | undefined;
  if (lock) {
    await loadPreset(page, preset.id);
    const lockedRamp = await captureResponse(page, RAMP_FRAMES, rampSpec, true);
    if (!lockedRamp.error && lockedRamp.responseSeries) {
      responsivenessLocked = pearsonCorrelation(
        rampGround,
        lockedRamp.responseSeries,
      );
    }
    await loadPreset(page, preset.id);
    const lockedFlat = await captureResponse(
      page,
      FLAT_FRAMES,
      { type: 'flat', level: 0.4 },
      true,
    );
    autonomyLocked =
      !lockedFlat.error && lockedFlat.responseSeries
        ? autonomyVariance(lockedFlat.responseSeries)
        : undefined;
  }

  return {
    ...base,
    responsiveness,
    latencyFrames,
    latencyCorrelation,
    persistenceFrames,
    autonomy,
    bassResponsiveness,
    trebleResponsiveness,
    selectivity:
      bassResponsiveness !== undefined && trebleResponsiveness !== undefined
        ? bassResponsiveness - trebleResponsiveness
        : undefined,
    responsivenessLocked,
    autonomyLocked,
  };
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
    : sampleEvenly(allPresets, args.count);

  console.log(
    `Characterizing ${targets.length} of ${allPresets.length} presets ` +
      `(${args.lock ? '7' : '5'} trials/preset: ramp, transient, flat, bass, ` +
      `treble${args.lock ? ', ramp-locked, flat-locked' : ''})`,
  );

  const devServer = await ensureDevServer(args.port);
  const browser = await chromium.launch({ headless: args.headless });
  const ctx = await browser.newContext({ viewport: VIEWPORT });
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

  const reports: PresetTransferReport[] = [];

  try {
    await bootPage(targets[0]?.id ?? '');

    for (const [index, preset] of targets.entries()) {
      const label = `[${index + 1}/${targets.length}] ${preset.id}`;
      try {
        const report = await analyzePreset(page, preset, args.lock);
        reports.push(report);
        if (report.error) {
          console.log(`${label} — SKIP (${report.error})`);
        } else {
          console.log(
            `${label} — resp=${report.responsiveness?.toFixed(3)} ` +
              `lag=${report.latencyFrames}f(r=${report.latencyCorrelation?.toFixed(2)}) ` +
              `persist=${report.persistenceFrames ?? 'n/a'}f ` +
              `autonomy=${report.autonomy?.toFixed(5)} ` +
              `selectivity=${report.selectivity?.toFixed(3)}` +
              (args.lock
                ? ` respLocked=${report.responsivenessLocked?.toFixed(3)} ` +
                  `autonomyLocked=${report.autonomyLocked?.toFixed(5)}`
                : ''),
          );
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.log(`${label} — FAIL (${reason.slice(0, 100)})`);
        reports.push({
          presetId: preset.id,
          title: preset.title ?? preset.id,
          author: preset.author ?? '',
          error: reason.slice(0, 200),
        });
        if (page.isClosed() || /closed|crash/i.test(reason)) {
          await page.close().catch(() => {});
          page = await ctx.newPage();
          await bootPage(preset.id);
        }
      }
    }
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    devServer.close();
  }

  writeFileSync(args.out, `${JSON.stringify({ reports }, null, 2)}\n`);
  console.log(`\nWrote ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
