#!/usr/bin/env bun
/**
 * Captures the feature screenshots the /whats-new/ page shows.
 *
 * Drives the running app through its agent API (open-settings, open-browse)
 * rather than scraping the DOM, so a screenshot shows the real surface a
 * visitor reaches. Output goes to public/screenshots/whats-new/.
 *
 *   bun run capture:whats-new
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { resolveAgentChromiumArgs } from './browser-launch.ts';
import { spawnDevServer } from './dev-server.ts';

const PORT = 5199;
const OUT_DIR = 'public/screenshots/whats-new';
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1440, height: 900 };

async function waitForAgent(page: Page, timeout = 60_000) {
  await page.waitForFunction(
    () => Boolean((window as any).__stims_agent),
    undefined,
    { timeout },
  );
}

async function run(page: Page, action: string) {
  await page.evaluate(async (id) => {
    await (window as any).__stims_agent.run(id);
  }, action);
}

async function shoot(page: Page, name: string, opts?: { fullPage?: boolean }) {
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file, fullPage: opts?.fullPage ?? false });
  console.log(`wrote ${file}`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await spawnDevServer({
    port: PORT,
    command: [
      'bun',
      'run',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--strictPort',
    ],
  });
  const browser = await chromium.launch({ args: resolveAgentChromiumArgs() });
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/?preset=shifter-curlique&agent=true`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForAgent(page);
    await page.evaluate(async () => {
      await (window as any).__stims_agent.waitFor(
        (s: { engineReady: boolean }) => s.engineReady,
        60_000,
      );
    });
    // Headless Chromium gates autoplay, so a `?preset=` link can land on a
    // ready-but-silent stage. Start the demo track explicitly.
    await page.evaluate(async () => {
      if ((window as any).__stims_agent.getState().engineState !== 'live') {
        await (window as any).__stims_agent.run('audio-demo');
      }
    });
    await page.evaluate(async () => {
      await (window as any).__stims_agent.waitFor(
        (s: { engineState: string }) => s.engineState === 'live',
        60_000,
      );
    });
    // Let the preset settle into a representative frame.
    await page.waitForTimeout(2500);

    // Settings -> Accessibility (sensory dials + voice switch).
    await run(page, 'open-settings');
    await page.waitForTimeout(600);
    await page.locator('#tab-accessibility').click();
    await page.waitForTimeout(600);
    const sensory = page.locator('#sensory-overload-ceiling');
    if (await sensory.count()) {
      await sensory.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await shoot(page, 'sensory-dials.png');
    }
    const voice = page.getByText('Hands-free voice commands', {
      exact: false,
    });
    if (await voice.count()) {
      await voice.first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await shoot(page, 'voice-commands.png');
    }
    await run(page, 'open-settings'); // toggle closed
    await page.waitForTimeout(400);

    // A brighter preset for the gesture card, with the first-run hint gone.
    const selected = await page.evaluate(async () => {
      return (window as any).__stims_agent.run('select-preset', {
        id: 'geiss-flower-blossom',
      });
    });
    console.log(
      'select-preset result:',
      JSON.stringify(selected)?.slice(0, 200),
    );
    await page.evaluate(async () => {
      await (window as any).__stims_agent.waitFor(
        (s: { presetId: string | null }) =>
          s.presetId === 'geiss-flower-blossom',
        20_000,
      );
    });
    await page.waitForTimeout(3500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await shoot(page, 'canvas-gestures.png');

    // Browse -> aesthetic compass.
    await run(page, 'open-browse');
    const compassButton = page.locator(
      'button[aria-label="Aesthetic compass"]',
    );
    try {
      await compassButton
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 });
      await compassButton.first().click();
      await page.waitForTimeout(3500);
      await shoot(page, 'aesthetic-compass.png');
    } catch (error) {
      console.warn('compass button not found:', String(error).slice(0, 160));
      const count = await page
        .locator('[aria-label="Aesthetic compass"]')
        .count();
      console.warn('aria-label matches:', count);
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
