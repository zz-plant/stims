/**
 * E2E: Verify the engine mounts, loads a preset, and renders canvas content.
 * Uses headed Chromium for real GPU rendering on macOS.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import { chromium, devices } from 'playwright';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import {
  HEADLESS,
  WEBGL_RENDERER_ARGS as RENDERER_ARGS,
} from './webgl-launch.ts';

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

// A single preset navigation used to fan out into several redundant compile
// attempts before one won (up to 6 `[PresetLoad]` groups for one requested
// preset, the winning path itself compiling the source twice). Root-caused
// to workspace-hooks' StrictMode-remount teardown racing the async engine-
// adapter factory and fixed in 0c5c979d — locally that's now 3 groups with
// a single compile, the other two cheap and cancelled before they compile
// anything. The remaining cost is the one real compile's GPU work itself:
// applyCompiledPreset alone has been observed taking 5-13s in CI under
// SwiftShader's software rasterizer, against 1-4s on real GPU locally, so
// this budget stays wide for that reason rather than the fan-out.
const GPU_PROBE_TIMEOUT_MS = 120000;

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
    undefined,
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
      const canvas = await page.waitForSelector(
        '.stims-shell__stage-frame canvas',
        { timeout: 30000 },
      );
      expect(canvas).not.toBeNull();

      // Wait for the GPU to produce non-zero output before asserting.
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector(
            '.stims-shell__stage-frame canvas',
          ) as HTMLCanvasElement | null;
          if (!canvas || canvas.width === 0 || canvas.height === 0) {
            return false;
          }
          // Read-only probe. Calling getContext('webgl') here would bind a
          // context to the app's canvas whenever the poll wins the race
          // against renderer init — a canvas keeps its first context type
          // forever, so THREE's webgl2 init then fails ("existing context
          // of a different type") and the app must recover on a fresh
          // canvas. drawImage into a scratch 2D canvas reads the same
          // pixel without ever touching the app canvas's context.
          const scratch = document.createElement('canvas');
          scratch.width = 1;
          scratch.height = 1;
          const ctx = scratch.getContext('2d');
          if (!ctx) return false;
          ctx.drawImage(
            canvas,
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
            0,
            0,
            1,
            1,
          );
          const data = ctx.getImageData(0, 0, 1, 1).data;
          // RGB only: an opaque-black cleared buffer has alpha 255 and must
          // not count as rendered content.
          return data[0] > 0 || data[1] > 0 || data[2] > 0;
        },
        undefined,
        { timeout: GPU_PROBE_TIMEOUT_MS },
      );

      const info = await page.evaluate(() => {
        const c = document.querySelector(
          '.stims-shell__stage-frame canvas',
        ) as HTMLCanvasElement | null;
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
  { timeout: 240000 },
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
      await page.waitForSelector('.stims-shell__stage-frame canvas', {
        timeout: 30000,
      });
      // Wait for the GPU to produce non-zero output before capturing.
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector(
            '.stims-shell__stage-frame canvas',
          ) as HTMLCanvasElement | null;
          if (!canvas || canvas.width === 0 || canvas.height === 0) {
            return false;
          }
          // Read-only probe. Calling getContext('webgl') here would bind a
          // context to the app's canvas whenever the poll wins the race
          // against renderer init — a canvas keeps its first context type
          // forever, so THREE's webgl2 init then fails ("existing context
          // of a different type") and the app must recover on a fresh
          // canvas. drawImage into a scratch 2D canvas reads the same
          // pixel without ever touching the app canvas's context.
          const scratch = document.createElement('canvas');
          scratch.width = 1;
          scratch.height = 1;
          const ctx = scratch.getContext('2d');
          if (!ctx) return false;
          ctx.drawImage(
            canvas,
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
            0,
            0,
            1,
            1,
          );
          const data = ctx.getImageData(0, 0, 1, 1).data;
          // RGB only: an opaque-black cleared buffer has alpha 255 and must
          // not count as rendered content.
          return data[0] > 0 || data[1] > 0 || data[2] > 0;
        },
        undefined,
        { timeout: GPU_PROBE_TIMEOUT_MS },
      );

      const hash1 = await page.evaluate(() =>
        document
          .querySelector<HTMLCanvasElement>('.stims-shell__stage-frame canvas')
          ?.toDataURL('image/png'),
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
      await page.waitForSelector('.stims-shell__stage-frame canvas', {
        timeout: 30000,
      });

      // Wait for the GPU to produce non-zero output after the preset switch.
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector(
            '.stims-shell__stage-frame canvas',
          ) as HTMLCanvasElement | null;
          if (!canvas || canvas.width === 0 || canvas.height === 0) {
            return false;
          }
          // Read-only probe. Calling getContext('webgl') here would bind a
          // context to the app's canvas whenever the poll wins the race
          // against renderer init — a canvas keeps its first context type
          // forever, so THREE's webgl2 init then fails ("existing context
          // of a different type") and the app must recover on a fresh
          // canvas. drawImage into a scratch 2D canvas reads the same
          // pixel without ever touching the app canvas's context.
          const scratch = document.createElement('canvas');
          scratch.width = 1;
          scratch.height = 1;
          const ctx = scratch.getContext('2d');
          if (!ctx) return false;
          ctx.drawImage(
            canvas,
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
            0,
            0,
            1,
            1,
          );
          const data = ctx.getImageData(0, 0, 1, 1).data;
          // RGB only: an opaque-black cleared buffer has alpha 255 and must
          // not count as rendered content.
          return data[0] > 0 || data[1] > 0 || data[2] > 0;
        },
        undefined,
        { timeout: GPU_PROBE_TIMEOUT_MS },
      );

      const hash2 = await page.evaluate(() =>
        document
          .querySelector<HTMLCanvasElement>('.stims-shell__stage-frame canvas')
          ?.toDataURL('image/png'),
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
  { timeout: 240000 },
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
      undefined,
      { timeout: 30000 },
    );
    await page.waitForFunction(
      () => window.location.search.includes('audio=microphone'),
      undefined,
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
