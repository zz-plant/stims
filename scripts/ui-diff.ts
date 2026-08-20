#!/usr/bin/env bun
/**
 * UI diff script for the visualizer iteration harness.
 *
 * Captures screenshots of registered components at configured breakpoints,
 * diffs each against a locally stored baseline (pixel-changed ratio, not an
 * eyeball comparison), and reports console errors/warnings alongside it.
 * The UI harness (`bun run dev:ui`, :5174) renders components in isolation
 * with no WebGL, so this works the same with or without a GPU.
 *
 * Usage:
 *   bun run ui:diff                        # capture + diff vs. baseline
 *   bun run ui:diff -- --update-baseline    # accept current captures as baseline
 *   bun run ui:diff -- --output=./out --baseline=./out-baseline
 *
 * First run (no baseline yet) creates one and reports `baseline-created`,
 * not `changed` — there is nothing to regress against yet.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { resolveAgentChromiumArgs } from './browser-launch.ts';
import type { RawImage } from './preset-lab-metrics.ts';

const DEFAULT_OUTPUT = './screenshots/ui-diff';
const DEFAULT_BASELINE = './screenshots/ui-diff-baseline';
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
const OUTPUT_DIR = outputArg
  ? outputArg.slice('--output='.length)
  : DEFAULT_OUTPUT;
const baselineArg = process.argv.find((arg) => arg.startsWith('--baseline='));
const BASELINE_DIR = baselineArg
  ? baselineArg.slice('--baseline='.length)
  : DEFAULT_BASELINE;
const UPDATE_BASELINE = process.argv.includes('--update-baseline');
/** Ratio above which a capture counts as visually changed vs. its baseline. */
const CHANGED_RATIO_THRESHOLD = 0.005;

const COMPONENTS = [
  'WorkspaceLaunchPanel',
  'WorkspaceStagePanel',
  'WorkspaceToolSheet',
  'WorkspaceToast',
] as const;

const BREAKPOINTS = [375, 768, 1024, 1920] as const;

const HARNESS_PORT = 5174;
const BASE_URL =
  process.env.UI_HARNESS_URL ?? `http://localhost:${HARNESS_PORT}`;

async function isHarnessUp(): Promise<boolean> {
  try {
    const response = await fetch(BASE_URL, {
      signal: AbortSignal.timeout(1500),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Starts `vite --config vite.config.ui.js` if BASE_URL isn't already
 * serving. Only used when the caller relies on the default port — a custom
 * UI_HARNESS_URL is assumed to already be running (e.g. CI, a shared dev
 * session) and is never auto-started or torn down.
 */
async function ensureUiHarness(): Promise<() => void> {
  if (process.env.UI_HARNESS_URL || (await isHarnessUp())) {
    return () => {};
  }
  console.log(
    `Starting UI harness (vite.config.ui.js) on port ${HARNESS_PORT}...`,
  );
  const child = spawn(
    process.execPath,
    [
      './node_modules/vite/bin/vite.js',
      '--config',
      'vite.config.ui.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(HARNESS_PORT),
      '--strictPort',
    ],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, BROWSER: 'none' },
    },
  );
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('UI harness exited before it could start.');
    }
    if (await isHarnessUp()) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return () => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  };
}

async function waitForPageReady(page: import('playwright').Page) {
  await page.waitForLoadState('networkidle');
  // Wait for fonts to settle
  await page.waitForTimeout(500);
}

async function captureComponent(
  browser: import('playwright').Browser,
  component: string,
  width: number,
) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const url = `${BASE_URL}/?component=${component}&grid=${width}`;

  const consoleMessages: Array<{ type: string; text: string }> = [];
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      consoleMessages.push({ type, text: msg.text() });
    }
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await waitForPageReady(page);

  const screenshotPath = path.join(OUTPUT_DIR, `${component}-${width}.png`);
  const screenshotBuffer = await page.screenshot({
    path: screenshotPath,
    fullPage: false,
  });

  await context.close();

  return {
    component,
    width,
    screenshotPath,
    screenshotBuffer,
    consoleErrors: consoleMessages.filter((m) => m.type === 'error'),
    consoleWarnings: consoleMessages.filter((m) => m.type === 'warning'),
  };
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

/** RGBA, which is what pixelmatch requires. */
async function decodeRgba(
  buffer: Buffer,
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

type DiffVerdict =
  | 'baseline-created'
  | 'unchanged'
  | 'changed'
  | 'size-mismatch';

async function diffAgainstBaseline(
  component: string,
  width: number,
  screenshotBuffer: Buffer,
): Promise<{ verdict: DiffVerdict; changedPixelRatio: number | null }> {
  const baselinePath = path.join(BASELINE_DIR, `${component}-${width}.png`);

  const baselineBuffer = UPDATE_BASELINE
    ? null
    : await readFile(baselinePath).catch(() => null);

  if (UPDATE_BASELINE || !baselineBuffer) {
    await mkdir(BASELINE_DIR, { recursive: true });
    await writeFile(baselinePath, screenshotBuffer);
    return { verdict: 'baseline-created', changedPixelRatio: null };
  }

  const [current, baseline] = await Promise.all([
    decodePng(screenshotBuffer),
    decodePng(baselineBuffer),
  ]);
  if (
    current.width !== baseline.width ||
    current.height !== baseline.height ||
    current.channels !== baseline.channels
  ) {
    return { verdict: 'size-mismatch', changedPixelRatio: 1 };
  }

  // pixelmatch rather than the raw per-channel comparison used elsewhere in
  // the lab. These captures are UI, not shader output: text and borders
  // re-rasterize with slightly different anti-aliasing between runs and
  // machines, and a flat |Δchannel| > 4 test counts every one of those edge
  // pixels as changed. That is how a visual gate accumulates diffs nobody
  // believes, and a gate people override on sight is worse than none.
  // pixelmatch compares in YIQ (perceptual) and, with includeAA false,
  // classifies anti-aliased pixels and excludes them.
  //
  // preset-lab-visual.ts keeps computeChangedPixelRatio deliberately: its
  // motion series wants literal pixel churn between frames of a shader,
  // where "perceptually similar" is exactly the wrong question.
  const [currentRgba, baselineRgba] = await Promise.all([
    decodeRgba(screenshotBuffer),
    decodeRgba(baselineBuffer),
  ]);
  const diffOutput = Buffer.alloc(currentRgba.data.length);
  const changedPixels = pixelmatch(
    baselineRgba.data,
    currentRgba.data,
    diffOutput,
    currentRgba.width,
    currentRgba.height,
    { threshold: 0.1, includeAA: false },
  );
  const totalPixels = currentRgba.width * currentRgba.height;
  const changedPixelRatio = totalPixels === 0 ? 0 : changedPixels / totalPixels;

  // A ratio alone says something moved but never what. Writing the mask on a
  // real change turns triage from "re-run it locally and squint" into
  // opening one file.
  if (changedPixelRatio > CHANGED_RATIO_THRESHOLD) {
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(
      path.join(OUTPUT_DIR, `${component}-${width}-diff.png`),
      await sharp(diffOutput, {
        raw: {
          width: currentRgba.width,
          height: currentRgba.height,
          channels: 4,
        },
      })
        .png()
        .toBuffer(),
    );
  }
  return {
    verdict:
      changedPixelRatio > CHANGED_RATIO_THRESHOLD ? 'changed' : 'unchanged',
    changedPixelRatio,
  };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const closeHarness = await ensureUiHarness();

  const browser = await chromium.launch({ args: resolveAgentChromiumArgs() });
  const results: Array<{
    component: string;
    width: number;
    screenshotPath: string;
    consoleErrors: Array<{ type: string; text: string }>;
    consoleWarnings: Array<{ type: string; text: string }>;
    verdict: DiffVerdict;
    changedPixelRatio: number | null;
  }> = [];

  for (const component of COMPONENTS) {
    for (const width of BREAKPOINTS) {
      console.log(`Capturing ${component} @ ${width}px...`);
      const capture = await captureComponent(browser, component, width);
      const { verdict, changedPixelRatio } = await diffAgainstBaseline(
        component,
        width,
        capture.screenshotBuffer,
      );
      const { screenshotBuffer: _screenshotBuffer, ...rest } = capture;
      results.push({ ...rest, verdict, changedPixelRatio });
      const verdictGlyph =
        verdict === 'changed'
          ? '▼ CHANGED'
          : verdict === 'unchanged'
            ? '· unchanged'
            : verdict === 'baseline-created'
              ? '+ baseline created'
              : '! size mismatch';
      console.log(`  ${verdictGlyph}`);
    }
  }

  await browser.close();
  closeHarness();

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    baselineDir: BASELINE_DIR,
    summary: {
      total: results.length,
      errors: results.reduce((sum, r) => sum + r.consoleErrors.length, 0),
      warnings: results.reduce((sum, r) => sum + r.consoleWarnings.length, 0),
      changed: results.filter((r) => r.verdict === 'changed').length,
      sizeMismatch: results.filter((r) => r.verdict === 'size-mismatch').length,
      baselinesCreated: results.filter((r) => r.verdict === 'baseline-created')
        .length,
    },
    results,
  };

  const reportPath = path.join(OUTPUT_DIR, 'report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(`\nUI diff complete: ${report.summary.total} captures`);
  console.log(`  Errors: ${report.summary.errors}`);
  console.log(`  Warnings: ${report.summary.warnings}`);
  console.log(`  Changed vs baseline: ${report.summary.changed}`);
  if (report.summary.baselinesCreated > 0) {
    console.log(
      `  Baselines created (first run or --update-baseline): ${report.summary.baselinesCreated}`,
    );
  }
  console.log(`  Report: ${reportPath}`);

  if (report.summary.changed > 0 && !UPDATE_BASELINE) {
    console.log(
      '\nRun with --update-baseline once the change is confirmed intentional to accept it as the new baseline.',
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
