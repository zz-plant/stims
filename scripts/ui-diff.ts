#!/usr/bin/env bun
/**
 * UI diff script for the visualizer iteration harness.
 *
 * Captures screenshots of registered components at configured breakpoints
 * and reports changes, console errors, and basic metrics.
 *
 * Usage:
 *   bun scripts/ui-diff.ts [--output ./screenshots/ui-diff]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const DEFAULT_OUTPUT = './screenshots/ui-diff';
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
const OUTPUT_DIR = outputArg
  ? outputArg.slice('--output='.length)
  : DEFAULT_OUTPUT;

const COMPONENTS = [
  'WorkspaceLaunchPanel',
  'WorkspaceStagePanel',
  'WorkspaceToolSheet',
  'WorkspaceToast',
] as const;

const BREAKPOINTS = [375, 768, 1024, 1920] as const;

const BASE_URL = process.env.UI_HARNESS_URL ?? 'http://localhost:5174';

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
  await page.screenshot({ path: screenshotPath, fullPage: false });

  await context.close();

  return {
    component,
    width,
    screenshotPath,
    consoleErrors: consoleMessages.filter((m) => m.type === 'error'),
    consoleWarnings: consoleMessages.filter((m) => m.type === 'warning'),
  };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const results: Array<{
    component: string;
    width: number;
    screenshotPath: string;
    consoleErrors: Array<{ type: string; text: string }>;
    consoleWarnings: Array<{ type: string; text: string }>;
  }> = [];

  for (const component of COMPONENTS) {
    for (const width of BREAKPOINTS) {
      // eslint-disable-next-line no-console
      console.log(`Capturing ${component} @ ${width}px...`);
      const result = await captureComponent(browser, component, width);
      results.push(result);
    }
  }

  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    summary: {
      total: results.length,
      errors: results.reduce((sum, r) => sum + r.consoleErrors.length, 0),
      warnings: results.reduce((sum, r) => sum + r.consoleWarnings.length, 0),
    },
    results,
  };

  const reportPath = path.join(OUTPUT_DIR, 'report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  // eslint-disable-next-line no-console
  console.log(`\nUI diff complete: ${report.summary.total} captures`);
  // eslint-disable-next-line no-console
  console.log(`  Errors: ${report.summary.errors}`);
  // eslint-disable-next-line no-console
  console.log(`  Warnings: ${report.summary.warnings}`);
  // eslint-disable-next-line no-console
  console.log(`  Report: ${reportPath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
