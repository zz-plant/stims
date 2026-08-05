import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import type { MilkdropControlFlowStatement } from '../src/js/milkdrop/common-types.ts';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import { DEFAULT_VIEWPORT } from '../src/viewport-config.ts';
import { ensureDevServer } from './dev-server.ts';

const DEFAULT_PORT = 5192;
const DEFAULT_SETTLE_MS = 900;
const DEFAULT_CONCURRENCY = Math.min(
  4,
  Math.max(1, (os.availableParallelism?.() ?? os.cpus()?.length ?? 4) - 1),
);
const DEFAULT_FRAME_SAMPLE_MS = 900;
const LOAD_TIMEOUT_MS = 30_000;
const BLANK_LUMINANCE = 2;
const BLANK_VISIBLE_PIXEL_RATIO = 0.002;
const SPATIALLY_UNIFORM_LUMINANCE_DEVIATION = 1;
const STATIC_FRAME_DIFFERENCE_RATIO = 0.000_01;
const MIN_HEALTHY_FRAME_RATE = 30;

export const LOOP_PRESET_CANVAS_SELECTOR = '#stims-visualizer > canvas';
const LOOP_SWEEP_HIDDEN_ATTRIBUTE = 'data-stims-loop-sweep-hidden';

type CatalogEntry = {
  id: string;
  title: string;
  file: string;
};

export type LoopPresetCorpusEntry = CatalogEntry & {
  controlKinds: Array<MilkdropControlFlowStatement['kind']>;
  controlStatementCount: number;
};

export type LoopPresetFrameMetrics = {
  meanLuminance: number;
  visiblePixelRatio: number;
  luminanceStandardDeviation: number;
};

export type LoopPresetSweepStatus =
  | 'runtime-regression'
  | 'visual-regression'
  | 'performance-regression'
  | 'pass';

export type LoopPresetSweepClassificationInput = {
  loadError: string | null;
  consoleErrors: string[];
  frameRate: number | null;
  firstFrame: LoopPresetFrameMetrics | null;
  finalFrame: LoopPresetFrameMetrics | null;
  frameDifferenceRatio: number | null;
};

export type LoopPresetSweepClassification = {
  status: LoopPresetSweepStatus;
  severityScore: number;
  reasons: string[];
};

export type LoopPresetSweepResult = LoopPresetCorpusEntry &
  LoopPresetSweepClassification & {
    presetId: string;
    loadDurationMs: number | null;
    frameRate: number | null;
    maxFrameGapMs: number | null;
    audioEnergy: number | null;
    backend: string | null;
    firstFrame: LoopPresetFrameMetrics | null;
    finalFrame: LoopPresetFrameMetrics | null;
    frameDifferenceRatio: number | null;
    consoleErrors: string[];
    loadError: string | null;
    screenshot: string | null;
  };

type SweepOptions = {
  repoRoot: string;
  outputDir: string;
  port: number;
  headless: boolean;
  renderer: 'webgl' | 'webgpu';
  settleMs: number;
  frameSampleMs: number;
  presetIds?: string[];
  concurrency: number;
};

function collectControlStatements(
  value: unknown,
  controls: MilkdropControlFlowStatement[],
  seen: Set<object>,
) {
  if (!(value && typeof value === 'object') || seen.has(value)) {
    return;
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  const control = record.control as MilkdropControlFlowStatement | undefined;
  if (control?.kind === 'loop' || control?.kind === 'while') {
    controls.push(control);
  }

  for (const child of Object.values(record)) {
    collectControlStatements(child, controls, seen);
  }
}

export function buildLoopPresetCorpus(repoRoot: string) {
  const publicRoot = path.join(repoRoot, 'public');
  const catalog = JSON.parse(
    fs.readFileSync(
      path.join(publicRoot, 'milkdrop-presets', 'catalog.json'),
      'utf8',
    ),
  ) as { presets: CatalogEntry[] };
  const byId = new Map<string, LoopPresetCorpusEntry>();

  for (const entry of catalog.presets) {
    if (byId.has(entry.id)) {
      continue;
    }
    const source = fs.readFileSync(
      path.join(publicRoot, entry.file.replace(/^\//, '')),
      'latin1',
    );
    const compiled = compileMilkdropPresetSource(source, { id: entry.id });
    const controls: MilkdropControlFlowStatement[] = [];
    collectControlStatements(compiled.ir, controls, new Set());
    if (controls.length === 0) {
      continue;
    }

    byId.set(entry.id, {
      ...entry,
      controlKinds: [
        ...new Set(controls.map((control) => control.kind)),
      ].sort(),
      controlStatementCount: controls.length,
    });
  }

  return [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function isBlankFrame(frame: LoopPresetFrameMetrics | null) {
  return Boolean(
    frame &&
      frame.meanLuminance <= BLANK_LUMINANCE &&
      frame.visiblePixelRatio <= BLANK_VISIBLE_PIXEL_RATIO,
  );
}

function isSpatiallyUniformFrame(frame: LoopPresetFrameMetrics | null) {
  return Boolean(
    frame &&
      frame.luminanceStandardDeviation <= SPATIALLY_UNIFORM_LUMINANCE_DEVIATION,
  );
}

export function classifyLoopPresetSweepSample(
  sample: LoopPresetSweepClassificationInput,
): LoopPresetSweepClassification {
  const reasons: string[] = [];

  if (sample.loadError) {
    reasons.push(sample.loadError);
  }
  if (sample.consoleErrors.length > 0) {
    reasons.push(`${sample.consoleErrors.length} browser runtime error(s)`);
  }
  if (reasons.length > 0) {
    return {
      status: 'runtime-regression',
      severityScore: 400 + Math.min(50, sample.consoleErrors.length),
      reasons,
    };
  }

  if (!(sample.firstFrame && sample.finalFrame)) {
    return {
      status: 'visual-regression',
      severityScore: 350,
      reasons: ['Active canvas could not be captured'],
    };
  }

  if (isBlankFrame(sample.firstFrame) && isBlankFrame(sample.finalFrame)) {
    return {
      status: 'visual-regression',
      severityScore: 300,
      reasons: ['Both sampled canvas frames are effectively blank'],
    };
  }

  if (
    isSpatiallyUniformFrame(sample.firstFrame) &&
    isSpatiallyUniformFrame(sample.finalFrame)
  ) {
    return {
      status: 'visual-regression',
      severityScore: 290,
      reasons: ['Both sampled canvas frames are spatially uniform'],
    };
  }

  if (
    sample.frameDifferenceRatio !== null &&
    sample.frameDifferenceRatio <= STATIC_FRAME_DIFFERENCE_RATIO
  ) {
    return {
      status: 'visual-regression',
      severityScore: 250,
      reasons: ['Canvas did not visibly change between sampled frames'],
    };
  }

  if (sample.frameRate === null || sample.frameRate < MIN_HEALTHY_FRAME_RATE) {
    return {
      status: 'performance-regression',
      severityScore:
        100 +
        (sample.frameRate === null
          ? MIN_HEALTHY_FRAME_RATE
          : Math.max(0, MIN_HEALTHY_FRAME_RATE - sample.frameRate)),
      reasons: [
        sample.frameRate === null
          ? 'Frame cadence could not be sampled'
          : `Frame rate ${sample.frameRate.toFixed(1)} is below ${MIN_HEALTHY_FRAME_RATE} fps`,
      ],
    };
  }

  return { status: 'pass', severityScore: 0, reasons: [] };
}

export function rankLoopPresetSweepSamples<
  T extends {
    presetId: string;
    status: LoopPresetSweepStatus;
    severityScore: number;
  },
>(samples: readonly T[]) {
  return [...samples].sort(
    (left, right) =>
      right.severityScore - left.severityScore ||
      left.presetId.localeCompare(right.presetId),
  );
}

export function resolveLoopSweepChromiumArgs(
  renderer: SweepOptions['renderer'],
  headless: boolean,
) {
  if (renderer === 'webgpu') {
    return [
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--enable-features=WebGPU,SharedArrayBuffer',
    ];
  }
  if (!headless) {
    return ['--ignore-gpu-blocklist'];
  }
  return [
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--enable-webgl',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ];
}

async function inspectPng(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let luminanceTotal = 0;
  let luminanceSquareTotal = 0;
  let visiblePixels = 0;
  const pixelCount = info.width * info.height;

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const luminance =
      (data[offset] ?? 0) * 0.2126 +
      (data[offset + 1] ?? 0) * 0.7152 +
      (data[offset + 2] ?? 0) * 0.0722;
    luminanceTotal += luminance;
    luminanceSquareTotal += luminance * luminance;
    if (luminance > 8) {
      visiblePixels += 1;
    }
  }

  const meanLuminance = pixelCount > 0 ? luminanceTotal / pixelCount : 0;
  const luminanceVariance =
    pixelCount > 0
      ? Math.max(
          0,
          luminanceSquareTotal / pixelCount - meanLuminance * meanLuminance,
        )
      : 0;

  return {
    raw: data,
    width: info.width,
    height: info.height,
    channels: info.channels,
    metrics: {
      meanLuminance,
      visiblePixelRatio: pixelCount > 0 ? visiblePixels / pixelCount : 0,
      luminanceStandardDeviation: Math.sqrt(luminanceVariance),
    },
  };
}

function compareFrames(
  first: Awaited<ReturnType<typeof inspectPng>>,
  final: Awaited<ReturnType<typeof inspectPng>>,
) {
  if (
    first.width !== final.width ||
    first.height !== final.height ||
    first.channels !== final.channels
  ) {
    return 1;
  }
  let changedPixels = 0;
  const pixelCount = first.width * first.height;

  for (let offset = 0; offset < first.raw.length; offset += first.channels) {
    const changed =
      Math.abs((first.raw[offset] ?? 0) - (final.raw[offset] ?? 0)) > 4 ||
      Math.abs((first.raw[offset + 1] ?? 0) - (final.raw[offset + 1] ?? 0)) >
        4 ||
      Math.abs((first.raw[offset + 2] ?? 0) - (final.raw[offset + 2] ?? 0)) > 4;
    if (changed) {
      changedPixels += 1;
    }
  }

  return pixelCount > 0 ? changedPixels / pixelCount : 0;
}

export async function captureIsolatedVisualizerCanvas(
  page: Page,
  canvasSelector: string = LOOP_PRESET_CANVAS_SELECTOR,
) {
  const canvas = page.locator(canvasSelector).first();
  await page.evaluate(
    ({ canvasSelector, hiddenAttribute }) => {
      const activeCanvas = document.querySelector(canvasSelector);
      if (!(activeCanvas instanceof HTMLCanvasElement)) {
        throw new Error(`Missing visualizer canvas: ${canvasSelector}`);
      }
      for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
        if (element === activeCanvas || element.contains(activeCanvas)) {
          continue;
        }
        element.setAttribute(
          hiddenAttribute,
          JSON.stringify({
            value: element.style.getPropertyValue('visibility'),
            priority: element.style.getPropertyPriority('visibility'),
          }),
        );
        element.style.setProperty('visibility', 'hidden', 'important');
      }
    },
    {
      canvasSelector,
      hiddenAttribute: LOOP_SWEEP_HIDDEN_ATTRIBUTE,
    },
  );

  try {
    return await canvas.screenshot({ type: 'png' });
  } finally {
    await page.evaluate((hiddenAttribute) => {
      for (const element of document.querySelectorAll<HTMLElement>(
        `[${hiddenAttribute}]`,
      )) {
        const saved = element.getAttribute(hiddenAttribute);
        element.removeAttribute(hiddenAttribute);
        const previous = saved
          ? (JSON.parse(saved) as { value: string; priority: string })
          : { value: '', priority: '' };
        if (previous.value) {
          element.style.setProperty(
            'visibility',
            previous.value,
            previous.priority,
          );
        } else {
          element.style.removeProperty('visibility');
        }
      }
    }, LOOP_SWEEP_HIDDEN_ATTRIBUTE);
  }
}

async function measureFrameCadence(page: Page, durationMs: number) {
  return page.evaluate(
    (duration) =>
      new Promise<{ frameRate: number; maxFrameGapMs: number }>((resolve) => {
        const startedAt = performance.now();
        let previousAt = startedAt;
        let frameCount = 0;
        let maxFrameGapMs = 0;

        const sample = (now: number) => {
          frameCount += 1;
          maxFrameGapMs = Math.max(maxFrameGapMs, now - previousAt);
          previousAt = now;
          const elapsed = now - startedAt;
          if (elapsed >= duration) {
            resolve({
              frameRate: (frameCount * 1000) / elapsed,
              maxFrameGapMs,
            });
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
    durationMs,
  );
}

export async function waitForPreset(
  page: Page,
  presetId: string,
  canvasSelector: string = LOOP_PRESET_CANVAS_SELECTOR,
  timeoutMs: number = LOAD_TIMEOUT_MS,
) {
  await page.waitForFunction(
    ({ requestedPresetId, canvasSelector: selector }) => {
      // Telemetry is the reliable "preset active" signal; the stage frame's
      // data-active-preset-id attribute is lifecycle-dependent and can lag or
      // never appear (data-mode="home" states), so it is deliberately not
      // part of this gate.
      const telemetry = window.__STIMS_AGENT_TELEMETRY__;
      return (
        telemetry?.currentPresetId === requestedPresetId &&
        document.querySelector(selector) !== null
      );
    },
    {
      requestedPresetId: presetId,
      canvasSelector,
    },
    { timeout: timeoutMs },
  );
}

async function requestPreset(page: Page, presetId: string) {
  await page.evaluate((requestedPresetId) => {
    window.postMessage(
      { type: 'toil:load_preset', presetId: requestedPresetId },
      '*',
    );
  }, presetId);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function writeHtmlReport(outputDir: string, results: LoopPresetSweepResult[]) {
  const cards = results
    .map((result) => {
      const screenshot = result.screenshot
        ? `<img src="${escapeHtml(path.basename(result.screenshot))}" alt="${escapeHtml(result.title)}">`
        : '<div class="missing">No canvas capture</div>';
      return `<article data-status="${result.status}">${screenshot}<h2>${escapeHtml(result.title)}</h2><p><code>${escapeHtml(result.id)}</code></p><p>${result.status} · ${result.frameRate?.toFixed(1) ?? 'n/a'} fps · ${(result.frameDifferenceRatio ?? 0).toFixed(4)} frame delta</p><p>${escapeHtml(result.reasons.join('; ') || 'No regression detected')}</p></article>`;
    })
    .join('\n');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MilkDrop loop preset sweep</title><style>body{font:14px system-ui;background:#111;color:#eee;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}article{background:#1c1c1c;border:2px solid #333;border-radius:8px;overflow:hidden;padding-bottom:12px}article[data-status="runtime-regression"]{border-color:#ff5252}article[data-status="visual-regression"]{border-color:#ff9800}article[data-status="performance-regression"]{border-color:#ffeb3b}img,.missing{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#000}.missing{display:grid;place-items:center}h2,p{margin:8px 12px}h2{font-size:16px}code{overflow-wrap:anywhere}</style><h1>MilkDrop loop/while browser sweep</h1><p>Canonical route: <code>/?agent=true</code>. Results are ranked by impact.</p><main>${cards}</main></html>`;
  const reportPath = path.join(outputDir, 'index.html');
  fs.writeFileSync(reportPath, html);
  return reportPath;
}

async function capturePresetSample({
  page,
  preset,
  outputDir,
  settleMs,
  frameSampleMs,
  consoleErrors,
  firstPreset,
}: {
  page: Page;
  preset: LoopPresetCorpusEntry;
  outputDir: string;
  settleMs: number;
  frameSampleMs: number;
  consoleErrors: string[];
  firstPreset: boolean;
}): Promise<LoopPresetSweepResult> {
  const consoleStart = consoleErrors.length;
  const loadStartedAt = performance.now();
  let loadError: string | null = null;
  let loadDurationMs: number | null = null;
  let firstFrame: LoopPresetFrameMetrics | null = null;
  let finalFrame: LoopPresetFrameMetrics | null = null;
  let frameDifferenceRatio: number | null = null;
  let frameRate: number | null = null;
  let maxFrameGapMs: number | null = null;
  let screenshot: string | null = null;

  try {
    if (!firstPreset) {
      await requestPreset(page, preset.id);
    }
    await waitForPreset(page, preset.id);
    loadDurationMs = performance.now() - loadStartedAt;
    await page.waitForTimeout(settleMs);

    const firstBuffer = await captureIsolatedVisualizerCanvas(page);
    const firstInspection = await inspectPng(firstBuffer);
    firstFrame = firstInspection.metrics;

    const cadence = await measureFrameCadence(page, frameSampleMs);
    frameRate = cadence.frameRate;
    maxFrameGapMs = cadence.maxFrameGapMs;

    const finalBuffer = await captureIsolatedVisualizerCanvas(page);
    const finalInspection = await inspectPng(finalBuffer);
    finalFrame = finalInspection.metrics;
    frameDifferenceRatio = compareFrames(firstInspection, finalInspection);
    screenshot = path.join(outputDir, `${preset.id}.png`);
    fs.writeFileSync(screenshot, finalBuffer);

    const activePresetId = await page.evaluate(
      () => window.__STIMS_AGENT_TELEMETRY__?.currentPresetId ?? null,
    );
    if (activePresetId !== preset.id) {
      loadError = `Preset fell back to ${activePresetId ?? 'no active preset'} during the sample`;
    }
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  const telemetry = await page
    .evaluate(() => window.__STIMS_AGENT_TELEMETRY__ ?? null)
    .catch(() => null);
  const sampleConsoleErrors = consoleErrors.slice(consoleStart);
  const classification = classifyLoopPresetSweepSample({
    loadError,
    consoleErrors: sampleConsoleErrors,
    frameRate,
    firstFrame,
    finalFrame,
    frameDifferenceRatio,
  });

  return {
    ...preset,
    presetId: preset.id,
    ...classification,
    loadDurationMs,
    frameRate,
    maxFrameGapMs,
    audioEnergy: telemetry?.audioEnergy ?? null,
    backend: telemetry?.backend ?? null,
    firstFrame,
    finalFrame,
    frameDifferenceRatio,
    consoleErrors: sampleConsoleErrors,
    loadError,
    screenshot,
  };
}

export async function runLoopPresetVisualSweep(options: SweepOptions) {
  const allPresets = buildLoopPresetCorpus(options.repoRoot);
  const requested = options.presetIds?.length
    ? new Set(options.presetIds)
    : null;
  const presets = requested
    ? allPresets.filter((preset) => requested.has(preset.id))
    : allPresets;
  if (presets.length === 0) {
    throw new Error('No loop/while presets matched the requested filters.');
  }

  fs.mkdirSync(options.outputDir, { recursive: true });
  const server = await ensureDevServer(options.port, options.repoRoot);
  const browser = await chromium.launch({
    headless: options.headless,
    args: resolveLoopSweepChromiumArgs(options.renderer, options.headless),
  });
  const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
  await context.addInitScript(() => {
    window.localStorage.setItem('stims:onboarding-complete', 'true');
  });

  const results: LoopPresetSweepResult[] = new Array(presets.length);
  const concurrency = options.concurrency;
  let nextIndex = 0;

  try {
    async function worker() {
      while (nextIndex < presets.length) {
        const index = nextIndex++;
        const preset = presets[index];
        const page = await context.newPage();
        const consoleErrors: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', (error) => consoleErrors.push(error.message));

        try {
          const url = new URL(`http://127.0.0.1:${options.port}/`);
          url.searchParams.set('agent', 'true');
          url.searchParams.set('audio', 'demo');
          url.searchParams.set('renderer', options.renderer);
          url.searchParams.set('preset', preset.id);
          await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });

          const result = await capturePresetSample({
            page,
            preset,
            outputDir: options.outputDir,
            settleMs: options.settleMs,
            frameSampleMs: options.frameSampleMs,
            consoleErrors,
            firstPreset: true,
          });
          results[index] = result;
          console.log(
            `[${index + 1}/${presets.length}] ${preset.id}: ${result.status}`,
          );
        } finally {
          await page.close().catch(() => {});
        }
      }
    }

    const workerPromises = Array.from(
      { length: Math.min(concurrency, presets.length) },
      () => worker(),
    );
    const settled = await Promise.allSettled(workerPromises);
    const firstRejection = settled.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (firstRejection) {
      throw firstRejection.reason;
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close();
  }

  const ranked = rankLoopPresetSweepSamples(results);
  const counts = ranked.reduce<Record<LoopPresetSweepStatus, number>>(
    (totals, result) => {
      totals[result.status] += 1;
      return totals;
    },
    {
      'runtime-regression': 0,
      'visual-regression': 0,
      'performance-regression': 0,
      pass: 0,
    },
  );
  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    canonicalRoute: '/?agent=true',
    renderer: options.renderer,
    presetCount: ranked.length,
    counts,
    results: ranked,
  };
  const summaryPath = path.join(options.outputDir, 'summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  const reportPath = writeHtmlReport(options.outputDir, ranked);
  return { summary, summaryPath, reportPath };
}

function readArg(argv: string[], name: string, fallback: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

function parseArgs(argv: string[]): SweepOptions {
  const repoRoot = path.resolve(
    readArg(argv, '--repo-root', fileURLToPath(new URL('..', import.meta.url))),
  );
  return {
    repoRoot,
    outputDir: path.resolve(
      readArg(argv, '--output', './screenshots/loop-preset-sweep'),
    ),
    port: Number.parseInt(readArg(argv, '--port', `${DEFAULT_PORT}`), 10),
    headless: !argv.includes('--no-headless'),
    renderer:
      readArg(argv, '--renderer', 'webgl') === 'webgpu' ? 'webgpu' : 'webgl',
    settleMs: Number.parseInt(
      readArg(argv, '--settle-ms', `${DEFAULT_SETTLE_MS}`),
      10,
    ),
    frameSampleMs: Number.parseInt(
      readArg(argv, '--frame-sample-ms', `${DEFAULT_FRAME_SAMPLE_MS}`),
      10,
    ),
    presetIds: argv.flatMap((arg, index) =>
      arg === '--preset' && argv[index + 1] ? [argv[index + 1] as string] : [],
    ),
    concurrency: (() => {
      const raw = readArg(argv, '--concurrency', `${DEFAULT_CONCURRENCY}`);
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed >= 1
        ? parsed
        : DEFAULT_CONCURRENCY;
    })(),
  };
}

if (import.meta.main) {
  const result = await runLoopPresetVisualSweep(
    parseArgs(process.argv.slice(2)),
  );
  console.log(JSON.stringify(result, null, 2));
}
