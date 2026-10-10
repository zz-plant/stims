/**
 * Records the real Play → Edit → Share workflow for the README and launch.
 * Requires ffmpeg and Playwright Chromium. Run against a local dev server:
 * bun scripts/generate-workflow-demo.ts [--origin=http://127.0.0.1:5173]
 * Raw capture and browser evidence stay in output/playwright/workflow-demo;
 * the silent MP4 and accelerated GIF are generated into docs/assets/clips.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { decodePresetCodeFromHash } from '../src/js/frontend/url-state.ts';
import { hardwareAngleArgs } from './browser-launch.ts';
import { ensureDevServer } from './dev-server.ts';

const OUTPUT = 'output/playwright/workflow-demo';
const ASSETS = 'docs/assets/clips';
const VIEWPORT = { width: 1280, height: 720 };
const MIN_CLIP_SECONDS = 25;

const originArg = process.argv.find((arg) => arg.startsWith('--origin='));
const origin = new URL(originArg?.slice(9) ?? 'http://127.0.0.1:5173');
if (!['localhost', '127.0.0.1'].includes(origin.hostname)) {
  throw new Error(
    'Capture against localhost; review the clip before publishing.',
  );
}
const server = await ensureDevServer(Number(origin.port || 80));
mkdirSync(OUTPUT, { recursive: true });
mkdirSync(ASSETS, { recursive: true });
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  // Headless Chromium advertises native sharing on macOS but cannot show
  // its system sheet. Disable that capability so the app takes its real
  // clipboard fallback, rather than recording a cancelled native share.
  args: [...hardwareAngleArgs(), '--disable-features=WebShare'],
});
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  permissions: ['clipboard-read', 'clipboard-write'],
  recordVideo: { dir: OUTPUT, size: VIEWPORT },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const video = page.video();
const recordedAt = Date.now();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
let previousClipboard: string | null = null;
try {
  await page.goto(`${origin.origin}/?agent=true&renderer=webgl`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: 'Play demo', exact: true }).waitFor();
  previousClipboard = await page
    .evaluate(() => navigator.clipboard.readText())
    .catch(() => null);
  const start = (Date.now() - recordedAt) / 1000;
  await page.screenshot({ path: join(OUTPUT, '01-launch.png') });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Play demo', exact: true }).click();
  await page.waitForFunction(
    () => (window.__STIMS_AGENT_TELEMETRY__?.audioEnergy ?? 0) > 0,
    undefined,
    { timeout: 60000 },
  );
  await page.mouse.move(620, 678);
  await page.screenshot({ path: join(OUTPUT, '02-play.png') });
  await page.waitForTimeout(3500);
  // The dock auto-hides while watching; a pointer movement reveals it.
  await page.mouse.move(630, 680);
  await page
    .getByRole('button', { name: 'Edit this visual', exact: true })
    .click();
  const spin = page.getByRole('button', {
    name: 'Add a slow spin',
    exact: true,
  });
  await spin.waitFor();
  await page.screenshot({ path: join(OUTPUT, '03-edit.png') });
  await page.waitForTimeout(3500);
  await spin.click();
  await page.waitForFunction(() => {
    const hash = window.location.hash;
    return hash.startsWith('#code=') && hash.length > 100;
  });
  const source = decodePresetCodeFromHash(new URL(page.url()).hash);
  if (!source?.includes('rot=rot+0.02;'))
    throw new Error('The remix link does not carry the spin equation.');
  await page.screenshot({ path: join(OUTPUT, '04-spin.png') });
  await page.waitForTimeout(4000);
  await page
    .getByRole('button', { name: 'Preset actions', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Copy link to this edit', exact: true })
    .click();
  await page.getByRole('link', { name: 'Star Stims on GitHub' }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  if (decodePresetCodeFromHash(new URL(copied).hash) !== source)
    throw new Error('Copied link lost the editor source.');
  await page.screenshot({ path: join(OUTPUT, '05-shared.png') });
  // Hold the result; leave enough time to read the tip and copied-link state.
  const elapsed = (Date.now() - recordedAt) / 1000 - start;
  await page.waitForTimeout(
    Math.max(3000, (MIN_CLIP_SECONDS - elapsed) * 1000),
  );
  const duration = (Date.now() - recordedAt) / 1000 - start;
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  writeFileSync(
    join(OUTPUT, 'evidence.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        viewport: VIEWPORT,
        seconds: duration,
        sourcePreservedInCopiedLink: true,
        browserErrors: errors,
        silentRecording: true,
      },
      null,
      2,
    ),
  );
  if (previousClipboard !== null) {
    await page.evaluate(
      (text) => navigator.clipboard.writeText(text),
      previousClipboard,
    );
    previousClipboard = null;
  }
  await context.close();
  if (!video) throw new Error('Playwright did not record a video.');
  const raw = await video.path();
  const mp4 = join(ASSETS, 'stims-workflow.mp4');
  const gif = join(ASSETS, 'stims-workflow.gif');
  for (const command of [
    [
      'ffmpeg',
      '-y',
      '-i',
      raw,
      '-ss',
      String(start),
      '-t',
      String(duration),
      '-an',
      '-c:v',
      'libx264',
      '-crf',
      '25',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      mp4,
    ],
    [
      'ffmpeg',
      '-y',
      '-i',
      mp4,
      '-vf',
      'setpts=PTS/3,fps=6,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
      '-loop',
      '0',
      gif,
    ],
  ]) {
    const process = Bun.spawnSync(command, {
      stdout: 'ignore',
      stderr: 'pipe',
    });
    if (process.exitCode !== 0) throw new Error(process.stderr.toString());
  }
  console.log(`Recorded ${duration.toFixed(1)}s: ${mp4} and ${gif}`);
} catch (error) {
  await page.screenshot({ path: join(OUTPUT, 'failure.png') }).catch(() => {});
  console.error(
    await page
      .evaluate(() =>
        Array.from(document.querySelectorAll('[role="status"]')).map(
          (el) => el.textContent,
        ),
      )
      .catch(() => []),
  );
  throw error;
} finally {
  if (previousClipboard !== null && !page.isClosed()) {
    await page
      .evaluate(
        (text) => navigator.clipboard.writeText(text),
        previousClipboard,
      )
      .catch(() => {});
  }
  await context.close().catch(() => {});
  await browser.close();
  server.close();
}
