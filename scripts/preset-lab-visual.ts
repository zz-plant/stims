/**
 * Preset lab — browser visual report (works with or without computer vision).
 *
 * Renders a preset in headless Chromium twice — silence, then deterministic
 * demo audio — samples the isolated visualizer canvas, and reports numeric
 * visual-fidelity and pixel-level audio-reactivity metrics. Sighted agents
 * additionally get a labeled contact sheet (one PNG grid of every sampled
 * frame) and, in compare mode, a baseline-vs-current side-by-side image.
 *
 *   bun run lab:visual -- --preset eos-ether             # report + contact sheet
 *   bun run lab:visual -- --preset eos-ether --baseline  # snapshot metrics
 *   <edit the .milk file>
 *   bun run lab:visual -- --preset eos-ether --compare   # improved or not?
 *
 * All numbers land in scratch/preset-lab/<presetId>/visual/visual.json and on
 * stdout, so agents without vision can iterate on the same loop.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import sharp, { type OverlayOptions } from 'sharp';
import { DEFAULT_VIEWPORT } from '../src/viewport-config.ts';
import { ensureDevServer } from './dev-server.ts';
import {
  compareMetricRecords,
  computeChangedPixelRatio,
  computeImageMetrics,
  formatMetricDeltaLines,
  type ImageMetrics,
  type MetricComparisonSpec,
  pearsonCorrelation,
  type RawImage,
  summarizeSeries,
} from './preset-lab-metrics.ts';
import {
  captureIsolatedVisualizerCanvas,
  probeCaptureBackend,
  resolveLoopSweepChromiumArgs,
  SWEEP_CHROMIUM_CHANNEL,
  waitForPreset,
} from './run-milkdrop-loop-visual-sweep.ts';

const DEFAULT_OUTPUT_DIR = './scratch/preset-lab';
const DEFAULT_PORT = 5197;
/** Preset source resolution can take ~16s+ under SwiftShader. */
const PRESET_READY_TIMEOUT_MS = 60_000;
const DEFAULT_SAMPLES = 8;
const DEFAULT_INTERVAL_MS = 700;
const DEFAULT_SETTLE_MS = 1500;
const AUDIO_ACTIVE_TIMEOUT_MS = 15_000;
const TILE_WIDTH = 320;
const TILE_HEIGHT = 180;
const SHEET_LABEL_HEIGHT = 34;
const SHEET_ROW_LABEL_WIDTH = 96;

type VisualScenario = 'silence' | 'demo';

type SampledFrame = {
  metrics: ImageMetrics;
  audioEnergy: number | null;
  bands: { bass: number; mid: number; treble: number } | null;
  pngPath: string;
};

type ScenarioCapture = {
  scenario: VisualScenario;
  frames: SampledFrame[];
  /** Changed-pixel ratio between consecutive samples. */
  motionSeries: number[];
  consoleErrors: string[];
  loadError: string | null;
  audioActive: boolean;
  backend: string | null;
};

export type PresetVisualReport = {
  version: 1;
  presetId: string;
  renderer: 'webgl' | 'webgpu';
  /**
   * WebGL renderer string of the capturing browser ("ANGLE Metal Renderer…"
   * vs "SwiftShader…"). Absent in reports written before 2026-08-11.
   * Metrics from different backends must not be compared against each other.
   */
  captureBackend?: string | null;
  samples: number;
  intervalMs: number;
  scenarios: Record<
    VisualScenario,
    {
      meanLuminance: number;
      luminanceStdDev: number;
      visiblePixelRatio: number;
      colorfulness: number;
      clippedHighlightRatio: number;
      nearBlackFrameRatio: number;
      meanMotion: number;
      consoleErrorCount: number;
      loadError: string | null;
      audioActive: boolean;
      backend: string | null;
    }
  >;
  summary: {
    /** demo motion / silence motion; > 1.3 reads as pixel-level reactivity. */
    audioMotionRatio: number;
    motionDelta: number;
    /** Correlation between sampled audio energy and subsequent frame motion. */
    energyMotionCorrelation: number;
    luminanceDelta: number;
    colorfulnessDelta: number;
    nearBlackFrameRatio: number;
    verdict:
      | 'audio-reactive'
      | 'ambient-motion'
      | 'static'
      | 'blank'
      | 'broken';
    reasons: string[];
  };
  artifacts: {
    reportJson: string;
    contactSheet: string;
    framesDir: string;
    comparisonImage: string | null;
  };
};

function repoRootFromScript() {
  return path.resolve(fileURLToPath(new URL('..', import.meta.url)));
}

/**
 * The workspace mounts the visualizer canvas inside a stage frame. The frame's
 * data attributes are lifecycle-dependent, so the selector stays unqualified —
 * telemetry (checked in waitForPreset) confirms which preset is active.
 */
const STAGE_CANVAS_SELECTOR = '.stims-shell__stage-frame canvas';

/**
 * Captures the canvas framebuffer. WebGL: `toDataURL` (agent mode enables
 * `preserveDrawingBuffer`), which survives React re-mounting the canvas mid-
 * capture — element screenshots throw "Element is not attached to the DOM"
 * once demo audio activates. WebGPU canvases return blank from `toDataURL`,
 * so they fall back to the isolated element screenshot with a retry.
 */
async function captureCanvasPng(
  page: Page,
  selector: string,
  renderer: 'webgl' | 'webgpu',
): Promise<Buffer> {
  if (renderer === 'webgpu') {
    try {
      return await captureIsolatedVisualizerCanvas(page, selector);
    } catch {
      return await captureIsolatedVisualizerCanvas(page, selector);
    }
  }
  const dataUrl = await page.evaluate((canvasSelector) => {
    const canvas = document.querySelector<HTMLCanvasElement>(canvasSelector);
    if (!canvas) {
      throw new Error(`Missing visualizer canvas: ${canvasSelector}`);
    }
    return canvas.toDataURL('image/png');
  }, selector);
  const base64 = dataUrl.split(',')[1];
  if (!base64) {
    throw new Error('Canvas produced an empty data URL');
  }
  return Buffer.from(base64, 'base64');
}

async function decodePng(buffer: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

async function readTelemetrySample(page: Page) {
  return page
    .evaluate(() => {
      const telemetry = window.__STIMS_AGENT_TELEMETRY__ ?? null;
      const snapshot = window.stimState?.getDebugSnapshot?.('milkdrop') as
        | {
            frameState?: {
              signals?: { bass?: number; mid?: number; treb?: number };
            };
          }
        | null
        | undefined;
      const signals = snapshot?.frameState?.signals;
      return {
        audioEnergy:
          typeof telemetry?.audioEnergy === 'number'
            ? telemetry.audioEnergy
            : null,
        backend: telemetry?.backend ?? null,
        bands:
          signals && typeof signals.bass === 'number'
            ? {
                bass: signals.bass ?? 0,
                mid: signals.mid ?? 0,
                treble: signals.treb ?? 0,
              }
            : null,
      };
    })
    .catch(() => ({ audioEnergy: null, backend: null, bands: null }));
}

async function waitForAudioActive(page: Page) {
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

async function captureScenario({
  page,
  presetId,
  scenario,
  renderer,
  samples,
  intervalMs,
  settleMs,
  framesDir,
  consoleErrors,
}: {
  page: Page;
  presetId: string;
  scenario: VisualScenario;
  renderer: 'webgl' | 'webgpu';
  samples: number;
  intervalMs: number;
  settleMs: number;
  framesDir: string;
  consoleErrors: string[];
}): Promise<{ capture: ScenarioCapture; rawFrames: RawImage[] }> {
  const frames: SampledFrame[] = [];
  const rawFrames: RawImage[] = [];
  const motionSeries: number[] = [];
  let loadError: string | null = null;
  let audioActive = false;
  let backend: string | null = null;

  try {
    await waitForPreset(
      page,
      presetId,
      STAGE_CANVAS_SELECTOR,
      PRESET_READY_TIMEOUT_MS,
    );
    if (scenario === 'demo') {
      audioActive = await waitForAudioActive(page);
      if (!audioActive) {
        loadError = 'Demo audio did not activate within the timeout';
      }
    }
    await page.waitForTimeout(settleMs);

    for (let index = 0; index < samples; index += 1) {
      const buffer = await captureCanvasPng(
        page,
        STAGE_CANVAS_SELECTOR,
        renderer,
      );
      const raw = await decodePng(buffer);
      const telemetry = await readTelemetrySample(page);
      backend = telemetry.backend ?? backend;
      const pngPath = path.join(
        framesDir,
        `${scenario}-${String(index).padStart(2, '0')}.png`,
      );
      fs.writeFileSync(pngPath, buffer);
      frames.push({
        metrics: computeImageMetrics(raw),
        audioEnergy: telemetry.audioEnergy,
        bands: telemetry.bands,
        pngPath,
      });
      const previous = rawFrames[rawFrames.length - 1];
      if (previous) {
        motionSeries.push(computeChangedPixelRatio(previous, raw));
      }
      rawFrames.push(raw);
      if (index < samples - 1) {
        await page.waitForTimeout(intervalMs);
      }
    }
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  return {
    capture: {
      scenario,
      frames,
      motionSeries,
      consoleErrors: [...consoleErrors],
      loadError,
      audioActive: scenario === 'silence' ? true : audioActive,
      backend,
    },
    rawFrames,
  };
}

function summarizeScenario(capture: ScenarioCapture) {
  const metric = (selector: (metrics: ImageMetrics) => number) =>
    summarizeSeries(capture.frames.map((frame) => selector(frame.metrics)))
      .mean;
  const nearBlackFrames = capture.frames.filter(
    (frame) => frame.metrics.nearBlack,
  ).length;
  return {
    meanLuminance: metric((metrics) => metrics.meanLuminance),
    luminanceStdDev: metric((metrics) => metrics.luminanceStdDev),
    visiblePixelRatio: metric((metrics) => metrics.visiblePixelRatio),
    colorfulness: metric((metrics) => metrics.colorfulness),
    clippedHighlightRatio: metric((metrics) => metrics.clippedHighlightRatio),
    nearBlackFrameRatio:
      capture.frames.length > 0 ? nearBlackFrames / capture.frames.length : 1,
    meanMotion: summarizeSeries(capture.motionSeries).mean,
    consoleErrorCount: capture.consoleErrors.length,
    loadError: capture.loadError,
    audioActive: capture.audioActive,
    backend: capture.backend,
  };
}

function summarizeRun(
  silence: ScenarioCapture,
  demo: ScenarioCapture,
): PresetVisualReport['summary'] {
  const silenceSummary = summarizeScenario(silence);
  const demoSummary = summarizeScenario(demo);
  const reasons: string[] = [];

  const audioMotionRatio =
    demoSummary.meanMotion / Math.max(silenceSummary.meanMotion, 1e-6);
  const motionDelta = demoSummary.meanMotion - silenceSummary.meanMotion;

  // Driver: audio energy at sample i. Response: motion between samples i, i+1.
  const energySeries = demo.frames
    .slice(0, -1)
    .map((frame) => frame.audioEnergy ?? 0);
  const energyMotionCorrelation = pearsonCorrelation(
    energySeries,
    demo.motionSeries,
  );

  let verdict: PresetVisualReport['summary']['verdict'];
  if (silence.loadError || demo.loadError) {
    verdict = 'broken';
    reasons.push(silence.loadError ?? demo.loadError ?? 'load error');
  } else if (
    demoSummary.nearBlackFrameRatio > 0.5 &&
    silenceSummary.nearBlackFrameRatio > 0.5
  ) {
    verdict = 'blank';
    reasons.push('Most sampled frames are near-black in both scenarios');
  } else if (
    demoSummary.meanMotion < 1e-4 &&
    silenceSummary.meanMotion < 1e-4
  ) {
    verdict = 'static';
    reasons.push('Canvas barely changes between samples in either scenario');
  } else if (audioMotionRatio >= 1.3 || energyMotionCorrelation >= 0.5) {
    verdict = 'audio-reactive';
    if (audioMotionRatio >= 1.3) {
      reasons.push(
        `Demo audio multiplies pixel motion ${audioMotionRatio.toFixed(2)}× vs silence`,
      );
    }
    if (energyMotionCorrelation >= 0.5) {
      reasons.push(
        `Frame motion tracks audio energy (corr ${energyMotionCorrelation.toFixed(2)})`,
      );
    }
  } else {
    verdict = 'ambient-motion';
    reasons.push(
      'Preset animates, but demo audio does not measurably change pixel motion',
    );
  }

  if (demo.consoleErrors.length > 0) {
    reasons.push(`${demo.consoleErrors.length} browser console error(s)`);
  }

  return {
    audioMotionRatio,
    motionDelta,
    energyMotionCorrelation,
    luminanceDelta: demoSummary.meanLuminance - silenceSummary.meanLuminance,
    colorfulnessDelta: demoSummary.colorfulness - silenceSummary.colorfulness,
    nearBlackFrameRatio: demoSummary.nearBlackFrameRatio,
    verdict,
    reasons,
  };
}

function labelSvg(
  width: number,
  height: number,
  labels: Array<{ text: string; x: number; y: number; anchor?: string }>,
) {
  const texts = labels
    .map(
      (label) =>
        `<text x="${label.x}" y="${label.y}" fill="#e8e8e8" font-family="system-ui, sans-serif" font-size="16" text-anchor="${label.anchor ?? 'start'}">${label.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`,
    )
    .join('');
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${texts}</svg>`,
  );
}

/**
 * One labeled PNG grid — rows are scenarios, columns are samples over time —
 * so a vision-capable agent can judge an entire run from a single image read.
 */
export async function writeContactSheet({
  outputPath,
  presetId,
  rows,
}: {
  outputPath: string;
  presetId: string;
  rows: Array<{ label: string; frames: string[] }>;
}) {
  const columns = Math.max(1, ...rows.map((row) => row.frames.length));
  const width = SHEET_ROW_LABEL_WIDTH + columns * TILE_WIDTH;
  const height = SHEET_LABEL_HEIGHT + rows.length * TILE_HEIGHT;
  const composites: OverlayOptions[] = [];

  for (const [rowIndex, row] of rows.entries()) {
    for (const [columnIndex, framePath] of row.frames.entries()) {
      if (!fs.existsSync(framePath)) {
        continue;
      }
      const tile = await sharp(framePath)
        .resize(TILE_WIDTH, TILE_HEIGHT, { fit: 'cover' })
        .png()
        .toBuffer();
      composites.push({
        input: tile,
        left: SHEET_ROW_LABEL_WIDTH + columnIndex * TILE_WIDTH,
        top: SHEET_LABEL_HEIGHT + rowIndex * TILE_HEIGHT,
      });
    }
  }

  const labels = [
    { text: `${presetId} — preset lab contact sheet`, x: 8, y: 22 },
    ...rows.map((row, rowIndex) => ({
      text: row.label,
      x: 8,
      y: SHEET_LABEL_HEIGHT + rowIndex * TILE_HEIGHT + TILE_HEIGHT / 2,
    })),
    ...Array.from({ length: columns }, (_, columnIndex) => ({
      text: `t${columnIndex}`,
      x: SHEET_ROW_LABEL_WIDTH + columnIndex * TILE_WIDTH + 6,
      y: SHEET_LABEL_HEIGHT + 18,
    })),
  ];
  composites.push({ input: labelSvg(width, height, labels), left: 0, top: 0 });

  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 12, g: 12, b: 14 },
    },
  })
    .composite(composites)
    .png()
    .toFile(outputPath);
  return outputPath;
}

/** Side-by-side baseline vs current image for sighted before/after review. */
async function writeComparisonImage({
  outputPath,
  presetId,
  baselineFrame,
  currentFrame,
}: {
  outputPath: string;
  presetId: string;
  baselineFrame: string;
  currentFrame: string;
}) {
  const width = TILE_WIDTH * 2 * 2;
  const tileWidth = TILE_WIDTH * 2;
  const tileHeight = TILE_HEIGHT * 2;
  const height = SHEET_LABEL_HEIGHT + tileHeight;
  const [baselineTile, currentTile] = await Promise.all(
    [baselineFrame, currentFrame].map((framePath) =>
      sharp(framePath)
        .resize(tileWidth, tileHeight, { fit: 'cover' })
        .png()
        .toBuffer(),
    ),
  );
  await sharp({
    create: { width, height, channels: 3, background: { r: 12, g: 12, b: 14 } },
  })
    .composite([
      { input: baselineTile, left: 0, top: SHEET_LABEL_HEIGHT },
      { input: currentTile, left: tileWidth, top: SHEET_LABEL_HEIGHT },
      {
        input: labelSvg(width, SHEET_LABEL_HEIGHT, [
          { text: `${presetId} — baseline`, x: 8, y: 22 },
          { text: 'current', x: tileWidth + 8, y: 22 },
        ]),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toFile(outputPath);
  return outputPath;
}

const VISUAL_COMPARISON_SPECS: MetricComparisonSpec[] = [
  {
    key: 'audioMotionRatio',
    label: 'audio motion ratio',
    betterWhen: 'higher',
    tolerance: 0.1,
  },
  {
    key: 'energyMotionCorrelation',
    label: 'energy↔motion correlation',
    betterWhen: 'higher',
    tolerance: 0.1,
  },
  {
    key: 'nearBlackFrameRatio',
    label: 'near-black frames',
    betterWhen: 'lower',
    tolerance: 0.05,
  },
  {
    key: 'demoColorfulness',
    label: 'colorfulness (demo)',
    betterWhen: 'higher',
    tolerance: 0.02,
  },
  {
    key: 'demoLuminanceStdDev',
    label: 'contrast (demo)',
    betterWhen: 'higher',
    tolerance: 2,
  },
  {
    key: 'demoConsoleErrors',
    label: 'console errors (demo)',
    betterWhen: 'lower',
    tolerance: 0,
  },
];

function comparisonMetrics(report: PresetVisualReport): Record<string, number> {
  return {
    audioMotionRatio: report.summary.audioMotionRatio,
    energyMotionCorrelation: report.summary.energyMotionCorrelation,
    nearBlackFrameRatio: report.summary.nearBlackFrameRatio,
    demoColorfulness: report.scenarios.demo.colorfulness,
    demoLuminanceStdDev: report.scenarios.demo.luminanceStdDev,
    demoConsoleErrors: report.scenarios.demo.consoleErrorCount,
  };
}

export function formatVisualReportText(report: PresetVisualReport): string {
  const lines: string[] = [];
  lines.push(`# Visual report — ${report.presetId} (${report.renderer})`);
  lines.push('');
  for (const scenario of ['silence', 'demo'] as const) {
    const summary = report.scenarios[scenario];
    lines.push(`## ${scenario}`);
    lines.push(`- mean luminance: ${summary.meanLuminance.toFixed(1)} / 255`);
    lines.push(
      `- contrast (luminance σ): ${summary.luminanceStdDev.toFixed(1)}`,
    );
    lines.push(
      `- visible pixels: ${(summary.visiblePixelRatio * 100).toFixed(1)}%`,
    );
    lines.push(`- colorfulness: ${summary.colorfulness.toFixed(3)}`);
    lines.push(
      `- clipped highlights: ${(summary.clippedHighlightRatio * 100).toFixed(1)}%`,
    );
    lines.push(
      `- near-black frames: ${(summary.nearBlackFrameRatio * 100).toFixed(0)}%`,
    );
    lines.push(
      `- mean inter-sample motion: ${(summary.meanMotion * 100).toFixed(2)}% of pixels`,
    );
    lines.push(`- console errors: ${summary.consoleErrorCount}`);
    if (summary.loadError) {
      lines.push(`- LOAD ERROR: ${summary.loadError}`);
    }
    lines.push('');
  }
  lines.push('## Audio reactivity (pixel level)');
  lines.push(`- verdict: ${report.summary.verdict}`);
  for (const reason of report.summary.reasons) {
    lines.push(`- ${reason}`);
  }
  lines.push(
    `- motion ratio demo/silence: ${report.summary.audioMotionRatio.toFixed(2)}`,
  );
  lines.push(
    `- energy↔motion correlation: ${report.summary.energyMotionCorrelation.toFixed(2)}`,
  );
  lines.push(
    `- luminance delta (demo − silence): ${report.summary.luminanceDelta.toFixed(1)}`,
  );
  lines.push('');
  lines.push(
    `Contact sheet (for vision-capable agents): ${report.artifacts.contactSheet}`,
  );
  lines.push(`Full JSON: ${report.artifacts.reportJson}`);
  return lines.join('\n');
}

export async function runPresetVisualLab({
  repoRoot,
  presetId,
  outputDir,
  port,
  renderer,
  samples,
  intervalMs,
  settleMs,
  headless,
}: {
  repoRoot: string;
  presetId: string;
  outputDir: string;
  port: number;
  renderer: 'webgl' | 'webgpu';
  samples: number;
  intervalMs: number;
  settleMs: number;
  headless: boolean;
}): Promise<PresetVisualReport> {
  const visualDir = path.join(outputDir, presetId, 'visual');
  const framesDir = path.join(visualDir, 'frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const server = await ensureDevServer(port, repoRoot);
  const browser = await chromium.launch({
    headless,
    channel: SWEEP_CHROMIUM_CHANNEL,
    args: resolveLoopSweepChromiumArgs(renderer, headless),
  });
  const captures = {} as Record<VisualScenario, ScenarioCapture>;
  let captureBackend: string | null = null;

  try {
    const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
    await context.addInitScript(() => {
      window.localStorage.setItem('stims:onboarding-complete', 'true');
    });
    captureBackend = await probeCaptureBackend(context);

    for (const scenario of ['silence', 'demo'] as const) {
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text());
        }
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message));
      try {
        const url = new URL(`http://127.0.0.1:${port}/`);
        url.searchParams.set('agent', 'true');
        url.searchParams.set('renderer', renderer);
        url.searchParams.set('preset', presetId);
        if (scenario === 'demo') {
          url.searchParams.set('audio', 'demo');
        }
        await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
        const { capture } = await captureScenario({
          page,
          presetId,
          scenario,
          renderer,
          samples,
          intervalMs,
          settleMs,
          framesDir,
          consoleErrors,
        });
        captures[scenario] = capture;
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await server.close();
  }

  const contactSheetPath = path.join(visualDir, 'contact-sheet.png');
  await writeContactSheet({
    outputPath: contactSheetPath,
    presetId,
    rows: (['silence', 'demo'] as const).map((scenario) => ({
      label: scenario,
      frames: captures[scenario].frames.map((frame) => frame.pngPath),
    })),
  });

  const reportJsonPath = path.join(visualDir, 'visual.json');
  const report: PresetVisualReport = {
    version: 1,
    presetId,
    renderer,
    captureBackend,
    samples,
    intervalMs,
    scenarios: {
      silence: summarizeScenario(captures.silence),
      demo: summarizeScenario(captures.demo),
    },
    summary: summarizeRun(captures.silence, captures.demo),
    artifacts: {
      reportJson: reportJsonPath,
      contactSheet: contactSheetPath,
      framesDir,
      comparisonImage: null,
    },
  };
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

type CliOptions = {
  presetIds: string[];
  outputDir: string;
  port: number;
  renderer: 'webgl' | 'webgpu';
  samples: number;
  intervalMs: number;
  settleMs: number;
  headless: boolean;
  writeBaseline: boolean;
  compare: boolean;
  json: boolean;
};

function readArg(argv: string[], name: string, fallback: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

function parseArgs(argv: string[]): CliOptions {
  return {
    presetIds: argv.flatMap((arg, index) =>
      arg === '--preset' && argv[index + 1] ? [argv[index + 1] as string] : [],
    ),
    outputDir: path.resolve(readArg(argv, '--out', DEFAULT_OUTPUT_DIR)),
    port: Number.parseInt(readArg(argv, '--port', `${DEFAULT_PORT}`), 10),
    renderer:
      readArg(argv, '--renderer', 'webgl') === 'webgpu' ? 'webgpu' : 'webgl',
    samples: Number.parseInt(
      readArg(argv, '--samples', `${DEFAULT_SAMPLES}`),
      10,
    ),
    intervalMs: Number.parseInt(
      readArg(argv, '--interval-ms', `${DEFAULT_INTERVAL_MS}`),
      10,
    ),
    settleMs: Number.parseInt(
      readArg(argv, '--settle-ms', `${DEFAULT_SETTLE_MS}`),
      10,
    ),
    headless: !argv.includes('--no-headless'),
    writeBaseline: argv.includes('--baseline'),
    compare: argv.includes('--compare'),
    json: argv.includes('--json'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.presetIds.length === 0) {
    console.error(
      'Usage: bun run lab:visual -- --preset <id> [--preset <id> …]\n' +
        '  [--samples 8] [--interval-ms 700] [--settle-ms 1500]\n' +
        '  [--renderer webgl|webgpu] [--port 5197] [--out scratch/preset-lab]\n' +
        '  [--baseline] [--compare] [--json] [--no-headless]',
    );
    process.exit(2);
  }
  const repoRoot = repoRootFromScript();

  for (const presetId of options.presetIds) {
    const report = await runPresetVisualLab({
      repoRoot,
      presetId,
      outputDir: options.outputDir,
      port: options.port,
      renderer: options.renderer,
      samples: options.samples,
      intervalMs: options.intervalMs,
      settleMs: options.settleMs,
      headless: options.headless,
    });

    const visualDir = path.join(options.outputDir, presetId, 'visual');
    const baselinePath = path.join(visualDir, 'visual.baseline.json');
    const baselineFramePath = path.join(visualDir, 'baseline-final-demo.png');
    const finalDemoFrame = path.join(
      report.artifacts.framesDir,
      `demo-${String(options.samples - 1).padStart(2, '0')}.png`,
    );

    if (options.writeBaseline) {
      fs.writeFileSync(baselinePath, `${JSON.stringify(report, null, 2)}\n`);
      if (fs.existsSync(finalDemoFrame)) {
        fs.copyFileSync(finalDemoFrame, baselineFramePath);
      }
    }

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatVisualReportText(report));
    }

    if (options.compare) {
      if (!fs.existsSync(baselinePath)) {
        console.error(
          `No baseline at ${baselinePath} — run with --baseline first.`,
        );
        process.exitCode = 1;
        continue;
      }
      const baseline = JSON.parse(
        fs.readFileSync(baselinePath, 'utf8'),
      ) as PresetVisualReport;
      if (
        (baseline.captureBackend ?? null) !== (report.captureBackend ?? null)
      ) {
        console.warn(
          `⚠ capture backend mismatch — baseline: ${
            baseline.captureBackend ?? 'unknown (captured before 2026-08-11)'
          }, current: ${report.captureBackend ?? 'unknown'}. ` +
            'Deltas below are not trustworthy. Re-run --baseline on this ' +
            'backend, or set STIMS_SOFTWARE_RENDER=1 to match an old baseline.',
        );
      }
      const deltas = compareMetricRecords(
        VISUAL_COMPARISON_SPECS,
        comparisonMetrics(baseline),
        comparisonMetrics(report),
      );
      console.log('');
      console.log(`# Visual comparison — ${presetId} (baseline vs current)`);
      console.log('');
      console.log(formatMetricDeltaLines(deltas).join('\n'));
      if (fs.existsSync(baselineFramePath) && fs.existsSync(finalDemoFrame)) {
        const comparisonPath = await writeComparisonImage({
          outputPath: path.join(visualDir, 'comparison.png'),
          presetId,
          baselineFrame: baselineFramePath,
          currentFrame: finalDemoFrame,
        });
        console.log('');
        console.log(
          `Side-by-side image (for vision-capable agents): ${comparisonPath}`,
        );
      }
    }
  }
}

if (import.meta.main) {
  await main();
}
