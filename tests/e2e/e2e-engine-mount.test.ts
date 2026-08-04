/**
 * E2E: Verify the engine mounts, loads a preset, and renders canvas content.
 * Uses headed Chromium for real GPU rendering on macOS.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import { chromium, devices } from 'playwright';
import { type DevServerHandle, startDevServer } from './dev-server.ts';

/**
 * Not every workflow installs Playwright browsers — upgrade-guardrails runs
 * `bun run test` without them, where chromium.launch() fails in milliseconds
 * and reads as a product regression. Skip instead, matching agent-integration.
 */
const hasChromium = fs.existsSync(chromium.executablePath());
const browserTest = hasChromium ? test : test.skip;

const TEST_PORT = 5181;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
let devServer: DevServerHandle | null = null;

/**
 * Headed Chromium is what exercises a real GPU locally, which is the point of
 * this suite on a developer machine. CI has no GPU: it runs under xvfb, and a
 * headed browser there dies partway through the first test. Headless plus a
 * software renderer is stable there and still produces real canvas content,
 * which is all these assertions read.
 */
const HEADLESS = !!process.env.CI;

/**
 * CI runs headed Chromium under xvfb with no real GPU. Without an explicit
 * software renderer the browser crashes mid-test, and the failure surfaces as
 * "Target page, context or browser has been closed" from the cleanup block
 * rather than as the crash it actually is. These are the same flags the
 * agent-integration suite already uses to stay green on CI.
 */
const RENDERER_ARGS = [
  '--use-angle=swiftshader',
  '--use-gl=angle',
  '--enable-webgl',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

/** Never let teardown mask the assertion failure that got us here. */
async function closeQuietly(
  ...closeables: Array<{ close: () => Promise<unknown> }>
) {
  for (const c of closeables) {
    try {
      await c.close();
    } catch {}
  }
}

async function waitForMountedStage(page: import('playwright').Page) {
  await page.waitForFunction(
    () =>
      document.querySelector('#stims-main[data-active-preset-id]') !== null &&
      document.querySelector('.stims-shell__stage-frame canvas') !== null,
    { timeout: 60000 },
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
      timeout: 60000,
    },
  );
}

async function startServer() {
  if (!hasChromium) return;
  devServer = await startDevServer({ port: TEST_PORT });
}

async function stopServer() {
  const server = devServer;
  devServer = null;
  await server?.stop();
}

beforeAll(() => startServer(), { timeout: 60000 });
afterAll(() => stopServer());

browserTest(
  'mounts engine, loads preset, and renders a silent preview frame',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: RENDERER_ARGS,
    });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      console.log(`[TEST BROWSER CONSOLE 1] ${msg.type()}: ${msg.text()}`);
    });

    try {
      // agent=true keeps the drawing buffer readable for readPixels below.
      await page.goto(
        `${SERVER_URL}/?preset=eos-glowsticks-v2-03-music&audio=none&agent=true`,
        { waitUntil: 'domcontentloaded' },
      );

      // App shell must be present
      await page.waitForSelector('#stims-main', { timeout: 30000 });
      const shell = await page.$('#stims-main');
      expect(shell).not.toBeNull();

      // A preset route mounts the runtime preview without inventing an audio source.
      await waitForMountedStage(page);
      await waitForActivePreset(page, 'eos-glowsticks-v2-03-music');

      // Canvas must appear once engine finishes mounting
      const canvas = await page.waitForSelector('canvas', { timeout: 30000 });
      expect(canvas).not.toBeNull();

      // Wait for the GPU to produce non-zero output before asserting.
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector(
            'canvas',
          ) as HTMLCanvasElement | null;
          if (!canvas) return false;
          const gl = (canvas.getContext('webgl') ||
            canvas.getContext('webgl2')) as WebGLRenderingContext | null;
          if (!gl) return false;
          const pixels = new Uint8Array(4);
          gl.readPixels(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels,
          );
          return pixels.some((p) => p > 0);
        },
        { timeout: 30000 },
      );

      const info = await page.evaluate(() => {
        const c = document.querySelector('canvas') as HTMLCanvasElement | null;
        if (!c) return null;
        return {
          width: c.width,
          height: c.height,
        };
      });

      expect(info).not.toBeNull();
      if (!info) throw new Error('canvas info is null');
      expect(info.width).toBeGreaterThan(0);
      expect(info.height).toBeGreaterThan(0);
    } finally {
      await closeQuietly(ctx, browser);
    }
  },
  { timeout: 120000 },
);

browserTest(
  'switches preset and canvas content changes',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: RENDERER_ARGS,
    });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      console.log(`[TEST BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
    });

    try {
      // Load first preset. agent=true turns on preserveDrawingBuffer —
      // without it, toDataURL() outside the frame callback reads the
      // cleared (opaque black) buffer, and both captures hash identically
      // no matter what the preset draws.
      await page.goto(
        `${SERVER_URL}/?preset=eos-glowsticks-v2-03-music&audio=none&agent=true`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForSelector('#stims-main', { timeout: 30000 });
      await waitForMountedStage(page);
      await waitForActivePreset(page, 'eos-glowsticks-v2-03-music');
      await page.waitForSelector('canvas', { timeout: 30000 });
      // Wait for the GPU to produce non-zero output before capturing.
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector(
            'canvas',
          ) as HTMLCanvasElement | null;
          if (!canvas) return false;
          const gl = (canvas.getContext('webgl') ||
            canvas.getContext('webgl2')) as WebGLRenderingContext | null;
          if (!gl) return false;
          const pixels = new Uint8Array(4);
          gl.readPixels(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels,
          );
          return pixels.some((p) => p > 0);
        },
        { timeout: 30000 },
      );

      const hash1 = await page.evaluate(() =>
        document.querySelector('canvas')?.toDataURL('image/png'),
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
      await page.waitForSelector('canvas', { timeout: 30000 });

      // Wait for the GPU to produce non-zero output after the preset switch.
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector(
            'canvas',
          ) as HTMLCanvasElement | null;
          if (!canvas) return false;
          const gl = (canvas.getContext('webgl') ||
            canvas.getContext('webgl2')) as WebGLRenderingContext | null;
          if (!gl) return false;
          const pixels = new Uint8Array(4);
          gl.readPixels(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels,
          );
          return pixels.some((p) => p > 0);
        },
        { timeout: 30000 },
      );

      const hash2 = await page.evaluate(() =>
        document.querySelector('canvas')?.toDataURL('image/png'),
      );

      // Verify the runtime switched to the requested preset.
      const activePresetId = await page
        .locator('.stims-shell__stage-frame')
        .first()
        .getAttribute('data-active-preset-id');
      expect(activePresetId).toBe('rovastar-parallel-universe');

      // Both frames must have content and they must differ.
      expect(hash1).toBeTruthy();
      expect(hash2).toBeTruthy();
      expect(hash1).not.toEqual(hash2);
    } finally {
      await closeQuietly(ctx, browser);
    }
  },
  { timeout: 120000 },
);

async function verifySmartphoneMicrophoneAccess({
  returningUser,
}: {
  returningUser: boolean;
}) {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      ...RENDERER_ARGS,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    ...(returningUser ? { permissions: ['microphone'] } : {}),
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
  if (returningUser) {
    await ctx.addInitScript(() => {
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices?.enumerateDevices) return;
      Object.defineProperty(mediaDevices, 'enumerateDevices', {
        configurable: true,
        value: async () => [
          {
            deviceId: 'previously-granted-phone-mic',
            groupId: 'phone-inputs',
            kind: 'audioinput',
            label: 'Phone microphone',
            toJSON: () => ({}),
          } satisfies MediaDeviceInfo,
        ],
      });
    });
  }
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
      { timeout: 30000 },
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
    // DEFAULT_MICROPHONE_CONSTRAINTS in src/js/core/audio-handler.ts.
    const audioConstraints = info.constraints?.audio as
      | MediaTrackConstraints
      | undefined;
    expect(audioConstraints).toBeTypeOf('object');
    expect(audioConstraints).toMatchObject({
      echoCancellation: { ideal: false },
      noiseSuppression: { ideal: false },
      autoGainControl: { ideal: false },
    });
    expect(audioConstraints).not.toHaveProperty('deviceId');

    expect(info.route).toContain('audio=microphone');
  } finally {
    await closeQuietly(ctx, browser);
  }
}

const smartphoneMicrophoneTest = hasChromium
  ? test.skipIf(!!process.env.CI)
  : test.skip;

smartphoneMicrophoneTest(
  'requests default microphone access for a first-time smartphone user',
  () => verifySmartphoneMicrophoneAccess({ returningUser: false }),
  { timeout: 120000 },
);

smartphoneMicrophoneTest(
  'reuses granted microphone access for a returning smartphone user',
  () => verifySmartphoneMicrophoneAccess({ returningUser: true }),
  { timeout: 120000 },
);
