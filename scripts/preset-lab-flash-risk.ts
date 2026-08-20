/**
 * Preset lab — flash-risk report.
 *
 * Renders a preset in headless Chromium and samples the visualizer canvas on
 * every animation frame (not on a fixed interval — see below) to estimate how
 * often its luminance swings sharply enough to be a photosensitivity concern.
 *
 *   bun run lab:flash-risk -- --preset eos-ether
 *   bun run lab:flash-risk -- --preset eos-ether --duration-ms 6000 --json
 *
 * All numbers land in scratch/preset-lab/<presetId>/flash-risk/flash-risk.json
 * and on stdout, matching the lab:visual / lab:reactivity report convention.
 *
 * WHY NOT preset-lab-visual.ts's existing capture loop: that tool samples 8
 * frames at 700ms apart (DEFAULT_SAMPLES / DEFAULT_INTERVAL_MS). That cadence
 * is fine for fidelity/reactivity comparisons but is far too coarse to see a
 * flash — a single bright-dark-bright cycle typically completes well inside
 * a 700ms window and would simply never be sampled. This tool instead injects
 * an in-page requestAnimationFrame loop that reads a luminance sample on every
 * rendered frame and returns only the resulting time series, not full PNGs,
 * so it can run at real frame rate without a per-frame encode/decode cost.
 *
 * WHY WEBGL ONLY: preset-lab-visual.ts's own capture code notes that WebGPU
 * canvases "return blank from toDataURL" and works around it with an
 * out-of-page element screenshot. The in-page drawImage()-based readback this
 * tool relies on is the same category of in-page read, so it should be
 * assumed unreliable on WebGPU here until it's specifically verified —
 * unverified flash-risk numbers on a safety-adjacent metric are worse than an
 * explicit gap. `--renderer webgpu` is intentionally rejected below rather
 * than silently producing numbers that look valid but were never checked.
 *
 * THRESHOLDS ARE PLACEHOLDERS. `FLASH_LUMINANCE_DELTA_THRESHOLD` and the
 * "transitions per second" framing are a first-pass heuristic, not a
 * certified photosensitive-epilepsy safety check and not sourced from a
 * specific broadcast/WCAG guideline — do not cite this tool's output as
 * compliance with any named standard. Treat its report as "relative flash
 * activity, comparable preset-to-preset" until someone with real domain
 * expertise sets thresholds against actual guidance.
 *
 * FOR WCAG EVALUATION, USE `scripts/analyze-preset-flash.ts` INSTEAD
 * (`bun run lab:flash-audit`). That tool implements WCAG 2.3.1 directly and
 * has been validated stage-by-stage against rendered output. This one
 * cannot be promoted to that role by retuning its threshold, because its
 * *reducer* is the problem, not its constant:
 *
 *   - It reduces each frame to one whole-frame mean luminance. Measurement
 *     on real presets found ~14% of a 10-degree field brightening while
 *     ~13% darkens *in the same frame* — so a whole-frame mean barely moves
 *     while a quarter of the field is changing hard. Directional
 *     cancellation makes this reducer blind to exactly the events it is
 *     trying to count.
 *   - A single scalar per frame also has no spatial extent, so WCAG's
 *     "25% of any 10 degree visual field" area criterion cannot be
 *     evaluated from it at all.
 *   - Its luminance is REC709 weights applied to gamma-encoded sRGB bytes,
 *     i.e. luma (Y'), where WCAG is defined on linearized relative
 *     luminance (Y).
 *
 * Kept because the single-preset, real-frame-rate, lab-report-convention
 * shape is genuinely useful for eyeballing one preset's relative activity,
 * which is what its numbers honestly are.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { DEFAULT_VIEWPORT } from '../src/viewport-config.ts';
import { ensureDevServer } from './dev-server.ts';
import {
  resolveLoopSweepChromiumArgs,
  SWEEP_CHROMIUM_CHANNEL,
  waitForPreset,
} from './run-milkdrop-loop-visual-sweep.ts';

const DEFAULT_OUTPUT_DIR = './scratch/preset-lab';
const DEFAULT_PORT = 5197;
const PRESET_READY_TIMEOUT_MS = 60_000;
const AUDIO_ACTIVE_TIMEOUT_MS = 15_000;
const DEFAULT_DURATION_MS = 4000;
/** Cheap downsample target for the in-page luminance readback. */
const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 18;
/**
 * PLACEHOLDER — see file header. A frame-to-frame mean-luminance swing (0-255
 * scale) at or above this counts as one side of a "flash" transition.
 */
const FLASH_LUMINANCE_DELTA_THRESHOLD = 30;
const STAGE_CANVAS_SELECTOR = '.stims-shell__stage-frame canvas';

type LuminanceSample = { t: number; y: number };

export type FlashRiskReport = {
  version: 1;
  presetId: string;
  renderer: 'webgl';
  captureBackend: string | null;
  audioActive: boolean;
  durationMs: number;
  sampleCount: number;
  meanFps: number;
  meanLuminance: number;
  maxLuminanceDelta: number;
  /**
   * Highest count of luminance-delta transitions (see
   * FLASH_LUMINANCE_DELTA_THRESHOLD) inside any rolling 1-second window of
   * the capture. PLACEHOLDER heuristic — see file header.
   */
  maxTransitionsPerSecondEstimate: number;
  consoleErrors: string[];
  loadError: string | null;
  artifacts: { reportJson: string };
};

/**
 * Runs entirely inside the page. Draws the live canvas onto a tiny offscreen
 * 2D canvas each animation frame (cheap, and works for any CanvasImageSource
 * including a WebGL-backed canvas) and records the mean luminance. Resolves
 * with the raw series once `durationMs` has elapsed.
 */
async function collectLuminanceSeries(
  page: Page,
  canvasSelector: string,
  durationMs: number,
): Promise<LuminanceSample[]> {
  return page.evaluate(
    ({ selector, duration, sampleWidth, sampleHeight }) => {
      return new Promise<LuminanceSample[]>((resolve, reject) => {
        const source = document.querySelector<HTMLCanvasElement>(selector);
        if (!source) {
          reject(new Error(`Missing visualizer canvas: ${selector}`));
          return;
        }
        const probe = document.createElement('canvas');
        probe.width = sampleWidth;
        probe.height = sampleHeight;
        const ctx = probe.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          reject(new Error('2D context unavailable for flash-risk probe'));
          return;
        }

        const series: LuminanceSample[] = [];
        const start = performance.now();
        let rafHandle = 0;

        const tick = () => {
          const now = performance.now();
          try {
            ctx.drawImage(source, 0, 0, sampleWidth, sampleHeight);
            const { data } = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
            let total = 0;
            const pixelCount = sampleWidth * sampleHeight;
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i] ?? 0;
              const g = data[i + 1] ?? 0;
              const b = data[i + 2] ?? 0;
              // Same REC 709 weights as preset-lab-metrics.ts's
              // computeImageMetrics, so flash-risk numbers stay comparable
              // to the fidelity/reactivity luminance metrics.
              total += r * 0.2126 + g * 0.7152 + b * 0.0722;
            }
            series.push({ t: now - start, y: total / pixelCount });
          } catch {
            // A transient blit failure (context loss mid-preset-switch,
            // canvas resize) just drops this frame's sample rather than
            // aborting the whole collection window.
          }
          if (now - start < duration) {
            rafHandle = requestAnimationFrame(tick);
          } else {
            resolve(series);
          }
        };

        rafHandle = requestAnimationFrame(tick);
        window.setTimeout(() => {
          cancelAnimationFrame(rafHandle);
          resolve(series);
        }, duration + 1000);
      });
    },
    {
      selector: canvasSelector,
      duration: durationMs,
      sampleWidth: SAMPLE_WIDTH,
      sampleHeight: SAMPLE_HEIGHT,
    },
  );
}

function maxTransitionsInRollingWindow(
  series: LuminanceSample[],
  windowMs: number,
): number {
  const transitionTimes: number[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1];
    const curr = series[i];
    if (!prev || !curr) continue;
    if (Math.abs(curr.y - prev.y) >= FLASH_LUMINANCE_DELTA_THRESHOLD) {
      transitionTimes.push(curr.t);
    }
  }
  let maxCount = 0;
  let windowStart = 0;
  for (let i = 0; i < transitionTimes.length; i += 1) {
    while (
      (transitionTimes[i] ?? 0) - (transitionTimes[windowStart] ?? 0) >
      windowMs
    ) {
      windowStart += 1;
    }
    maxCount = Math.max(maxCount, i - windowStart + 1);
  }
  return maxCount;
}

async function waitForAudioActive(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => document.body.dataset.audioActive === 'true',
      undefined,
      { timeout: AUDIO_ACTIVE_TIMEOUT_MS },
    );
    return true;
  } catch {
    return false;
  }
}

async function probeCaptureBackend(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      return String(gl.getParameter(param));
    });
  } catch {
    return null;
  }
}

export async function runPresetFlashRiskLab({
  repoRoot,
  presetId,
  outputDir,
  port,
  durationMs,
  headless,
}: {
  repoRoot: string;
  presetId: string;
  outputDir: string;
  port: number;
  durationMs: number;
  headless: boolean;
}): Promise<FlashRiskReport> {
  const reportDir = path.join(outputDir, presetId, 'flash-risk');
  fs.mkdirSync(reportDir, { recursive: true });

  const server = await ensureDevServer(port, repoRoot);
  const browser = await chromium.launch({
    headless,
    channel: SWEEP_CHROMIUM_CHANNEL,
    args: resolveLoopSweepChromiumArgs('webgl', headless),
  });

  const consoleErrors: string[] = [];
  let loadError: string | null = null;
  let audioActive = false;
  let captureBackend: string | null = null;
  let series: LuminanceSample[] = [];

  try {
    const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
    await context.addInitScript(() => {
      window.localStorage.setItem('stims:onboarding-complete', 'true');
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    try {
      const url = new URL(`http://127.0.0.1:${port}/`);
      url.searchParams.set('agent', 'true');
      url.searchParams.set('renderer', 'webgl');
      url.searchParams.set('preset', presetId);
      url.searchParams.set('audio', 'demo');
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
      await waitForPreset(
        page,
        presetId,
        STAGE_CANVAS_SELECTOR,
        PRESET_READY_TIMEOUT_MS,
      );
      audioActive = await waitForAudioActive(page);
      if (!audioActive) {
        loadError = 'Demo audio did not activate within the timeout';
      }
      captureBackend = await probeCaptureBackend(page);
      series = await collectLuminanceSeries(
        page,
        STAGE_CANVAS_SELECTOR,
        durationMs,
      );
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
    await server.close();
  }

  const luminances = series.map((sample) => sample.y);
  const meanLuminance =
    luminances.length > 0
      ? luminances.reduce((sum, value) => sum + value, 0) / luminances.length
      : 0;
  let maxLuminanceDelta = 0;
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1];
    const curr = series[i];
    if (!prev || !curr) continue;
    maxLuminanceDelta = Math.max(maxLuminanceDelta, Math.abs(curr.y - prev.y));
  }
  const lastSample = series[series.length - 1];
  const actualDurationMs = lastSample ? lastSample.t : durationMs;
  const meanFps =
    actualDurationMs > 0 ? (series.length / actualDurationMs) * 1000 : 0;

  const reportJsonPath = path.join(reportDir, 'flash-risk.json');
  const report: FlashRiskReport = {
    version: 1,
    presetId,
    renderer: 'webgl',
    captureBackend,
    audioActive,
    durationMs,
    sampleCount: series.length,
    meanFps,
    meanLuminance,
    maxLuminanceDelta,
    maxTransitionsPerSecondEstimate: maxTransitionsInRollingWindow(
      series,
      1000,
    ),
    consoleErrors,
    loadError,
    artifacts: { reportJson: reportJsonPath },
  };
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function formatFlashRiskReportText(report: FlashRiskReport): string {
  const lines: string[] = [];
  lines.push(`# Flash-risk report: ${report.presetId}`);
  lines.push('');
  if (report.loadError) {
    lines.push(`⚠ load error: ${report.loadError}`);
  }
  lines.push(
    `- captured ${report.sampleCount} frames over ${report.durationMs}ms (~${report.meanFps.toFixed(1)} fps, backend: ${report.captureBackend ?? 'unknown'})`,
  );
  lines.push(`- mean luminance: ${report.meanLuminance.toFixed(1)} / 255`);
  lines.push(
    `- largest single frame-to-frame luminance swing: ${report.maxLuminanceDelta.toFixed(1)}`,
  );
  lines.push(
    `- estimated flash-transition rate: ${report.maxTransitionsPerSecondEstimate} in the busiest 1s window ` +
      `(placeholder threshold: ${FLASH_LUMINANCE_DELTA_THRESHOLD}/255 delta — see file header, not a certified safety check)`,
  );
  if (report.consoleErrors.length > 0) {
    lines.push(`- console errors: ${report.consoleErrors.length}`);
  }
  return lines.join('\n');
}

function repoRootFromScript() {
  return path.resolve(fileURLToPath(new URL('..', import.meta.url)));
}

function readArg(argv: string[], name: string, fallback: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

type CliOptions = {
  presetIds: string[];
  outputDir: string;
  port: number;
  durationMs: number;
  headless: boolean;
  json: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  if (
    argv.includes('--renderer') &&
    readArg(argv, '--renderer', '') !== 'webgl'
  ) {
    throw new Error(
      'lab:flash-risk only supports --renderer webgl — see the WHY WEBGL ONLY ' +
        'note at the top of scripts/preset-lab-flash-risk.ts before changing this.',
    );
  }
  return {
    presetIds: argv.flatMap((arg, index) =>
      arg === '--preset' && argv[index + 1] ? [argv[index + 1] as string] : [],
    ),
    outputDir: path.resolve(readArg(argv, '--out', DEFAULT_OUTPUT_DIR)),
    port: Number.parseInt(readArg(argv, '--port', `${DEFAULT_PORT}`), 10),
    durationMs: Number.parseInt(
      readArg(argv, '--duration-ms', `${DEFAULT_DURATION_MS}`),
      10,
    ),
    headless: !argv.includes('--no-headless'),
    json: argv.includes('--json'),
  };
}

async function main() {
  console.warn(
    '⚠ lab:flash-risk is a relative-activity heuristic, NOT a WCAG 2.3.1 ' +
      'instrument: it reduces each frame to one whole-frame mean luminance, ' +
      'so opposing regional changes cancel and no spatial-area criterion is ' +
      'evaluated. For a real WCAG flash audit use `bun run lab:flash-audit` ' +
      '(scripts/analyze-preset-flash.ts). Do not cite these numbers as a ' +
      'safety result.\n',
  );
  const options = parseArgs(process.argv.slice(2));
  if (options.presetIds.length === 0) {
    console.error(
      'Usage: bun run lab:flash-risk -- --preset <id> [--preset <id> …]\n' +
        '  [--duration-ms 4000] [--port 5197] [--out scratch/preset-lab] [--json]',
    );
    process.exitCode = 1;
    return;
  }

  const repoRoot = repoRootFromScript();
  for (const presetId of options.presetIds) {
    const report = await runPresetFlashRiskLab({
      repoRoot,
      presetId,
      outputDir: options.outputDir,
      port: options.port,
      durationMs: options.durationMs,
      headless: options.headless,
    });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatFlashRiskReportText(report));
      console.log('');
    }
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
