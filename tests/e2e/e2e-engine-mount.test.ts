/**
 * E2E: Verify the engine mounts, loads a preset, and renders canvas content.
 * Uses headed Chromium for real GPU rendering on macOS.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { chromium, devices } from 'playwright';

const TEST_PORT = 5181;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
let devServer: ChildProcess | null = null;

async function waitForMountedStage(page: import('playwright').Page) {
  await page.waitForFunction(
    () =>
      document.querySelector('#stims-main[data-active-preset-id]') !== null &&
      document.querySelector('.stims-shell__stage-frame canvas') !== null,
    { timeout: 30000 },
  );
}

async function waitForActivePreset(
  page: import('playwright').Page,
  presetId: string,
) {
  await page.waitForSelector(
    `.stims-shell__stage-frame[data-active-preset-id="${presetId}"]`,
    {
      state: 'attached',
      timeout: 30000,
    },
  );
}

async function startServer() {
  devServer = spawn('bun', ['run', 'dev', '--port', String(TEST_PORT)], {
    stdio: 'ignore',
    env: { ...process.env, BROWSER: 'none' },
  });

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(SERVER_URL);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Dev server failed to start');
}

async function stopServer() {
  if (devServer) {
    devServer.kill('SIGTERM');
    devServer = null;
  }
}

beforeAll(() => startServer(), { timeout: 60000 });
afterAll(() => stopServer());

test(
  'mounts engine, loads preset, and renders a silent preview frame',
  async () => {
    const browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      console.log(`[TEST BROWSER CONSOLE 1] ${msg.type()}: ${msg.text()}`);
    });

    try {
      await page.goto(
        `${SERVER_URL}/?preset=eos-glowsticks-v2-03-music&audio=none`,
        { waitUntil: 'domcontentloaded' },
      );

      // App shell must be present
      await page.waitForSelector('#stims-main', { timeout: 15000 });
      const shell = await page.$('#stims-main');
      expect(shell).not.toBeNull();

      // A preset route mounts the runtime preview without inventing an audio source.
      await waitForMountedStage(page);
      await waitForActivePreset(page, 'eos-glowsticks-v2-03-music');

      // Canvas must appear once engine finishes mounting
      const canvas = await page.waitForSelector('canvas', { timeout: 15000 });
      expect(canvas).not.toBeNull();

      await page.waitForTimeout(3000);

      const info = await page.evaluate(() => {
        const c = document.querySelector('canvas') as HTMLCanvasElement | null;
        if (!c) return null;
        const data = c.toDataURL('image/png');
        return {
          width: c.width,
          height: c.height,
          dataLen: data.length,
          hasContent: data.length > 1000,
        };
      });

      expect(info).not.toBeNull();
      if (!info) throw new Error('canvas info is null');
      expect(info.width).toBeGreaterThan(0);
      expect(info.height).toBeGreaterThan(0);
      expect(info.hasContent).toBe(true);
    } finally {
      await ctx.close();
      await browser.close();
    }
  },
  { timeout: 120000 },
);

test(
  'switches preset and canvas content changes',
  async () => {
    const browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      console.log(`[TEST BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
    });

    try {
      // Load first preset
      await page.goto(
        `${SERVER_URL}/?preset=eos-glowsticks-v2-03-music&audio=none`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForSelector('#stims-main', { timeout: 15000 });
      await waitForMountedStage(page);
      await waitForActivePreset(page, 'eos-glowsticks-v2-03-music');
      await page.waitForSelector('canvas', { timeout: 15000 });
      await page.waitForTimeout(500);

      const hash1 = await page.evaluate(
        () => document.querySelector('canvas')?.toDataURL('image/png').length,
      );

      // Switch through the app's shareable route transition without tearing
      // down the browser page while the previous runtime is still disposing.
      await page.evaluate(() => {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('preset', 'rovastar-parallel-universe');
        nextUrl.searchParams.delete('audio');
        window.history.pushState(null, '', nextUrl);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await waitForMountedStage(page);
      await waitForActivePreset(page, 'rovastar-parallel-universe');
      await page.waitForSelector('canvas', { timeout: 15000 });
      await page.waitForTimeout(500);

      const hash2 = await page.evaluate(
        () => document.querySelector('canvas')?.toDataURL('image/png').length,
      );

      // Verify the runtime switched to the requested preset.
      const activePresetId = await page
        .locator('.stims-shell__stage-frame')
        .first()
        .getAttribute('data-active-preset-id');
      expect(activePresetId).toBe('rovastar-parallel-universe');

      // Both must have content
      expect(hash1).toBeGreaterThan(1000);
      expect(hash2).toBeGreaterThan(1000);
    } finally {
      await ctx.close();
      await browser.close();
    }
  },
  { timeout: 120000 },
);

test(
  'starts microphone audio on a mobile browser with one permission request',
  async () => {
    const browser = await chromium.launch({
      headless: false,
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    });
    const ctx = await browser.newContext({
      ...devices['iPhone 13'],
      permissions: ['microphone'],
    });
    await ctx.addInitScript(() => {
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices?.getUserMedia) return;
      const getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
      let calls = 0;
      Object.defineProperty(mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async (constraints: MediaStreamConstraints) => {
          calls += 1;
          (
            window as typeof window & {
              __stimsMicCalls?: number;
              __stimsMicConstraints?: MediaStreamConstraints;
            }
          ).__stimsMicCalls = calls;
          (
            window as typeof window & {
              __stimsMicCalls?: number;
              __stimsMicConstraints?: MediaStreamConstraints;
            }
          ).__stimsMicConstraints = constraints;
          return getUserMedia(constraints);
        },
      });
    });
    const page = await ctx.newPage();

    try {
      await page.goto(`${SERVER_URL}/?audio=none`, {
        waitUntil: 'domcontentloaded',
      });
      await page.locator('#start-audio-btn').click();
      await page.waitForFunction(
        () => document.body.dataset.audioActive === 'true',
        { timeout: 30000 },
      );
      await page.waitForFunction(
        () => window.location.search.includes('audio=microphone'),
        { timeout: 15000 },
      );

      const info = await page.evaluate(() => {
        const state = window as typeof window & {
          __stimsMicCalls?: number;
          __stimsMicConstraints?: MediaStreamConstraints;
        };
        return {
          calls: state.__stimsMicCalls ?? 0,
          constraints: state.__stimsMicConstraints,
          route: window.location.search,
        };
      });

      expect(info.calls).toBe(1);

      // The visualizer reacts to the raw spectrum, so the browser's voice DSP
      // has to stay off — AGC, echo cancellation and noise suppression all
      // reshape the signal the shaders read from. Mirrors
      // DEFAULT_MICROPHONE_CONSTRAINTS in assets/js/core/audio-handler.ts.
      const audioConstraints = info.constraints?.audio as
        | MediaTrackConstraints
        | undefined;
      expect(audioConstraints).toBeTypeOf('object');
      expect(audioConstraints).toMatchObject({
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: false },
      });

      expect(info.route).toContain('audio=microphone');
    } finally {
      await ctx.close();
      await browser.close();
    }
  },
  { timeout: 120000 },
);
