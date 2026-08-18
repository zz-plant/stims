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
 * Not every environment installs Playwright browsers — a bare `bun run test`
 * without them makes chromium.launch() fail in milliseconds and read as a
 * product regression. Skip instead, matching agent-integration.
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
// The probes poll at 250ms rather than animation-frame rate: each poll does
// a full-canvas readback through a scratch 2D canvas, which stalls the
// software rasterizer on every check. Slower polling cuts that interference
// while the probe is waiting for the first non-zero frame.
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

/**
 * Waits for the GPU to produce non-zero output anywhere on the stage canvas.
 *
 * The probe downscales the full frame into a small scratch canvas and scans
 * every sample instead of reading one pixel: presets like
 * rovastar-parallel-universe render a sparse starfield whose center pixel is
 * black on essentially every frame, so a single-pixel probe times out while
 * the preset is rendering perfectly well.
 *
 * Read-only probe. Calling getContext('webgl') here would bind a context to
 * the app's canvas whenever the poll wins the race against renderer init — a
 * canvas keeps its first context type forever, so THREE's webgl2 init then
 * fails ("existing context of a different type") and the app must recover on
 * a fresh canvas. drawImage into a scratch 2D canvas reads pixels without
 * ever touching the app canvas's context.
 */
async function waitForRenderedContent(page: import('playwright').Page) {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector(
        '.stims-shell__stage-frame canvas',
      ) as HTMLCanvasElement | null;
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        return false;
      }
      const SAMPLE_W = 32;
      const SAMPLE_H = 18;
      const scratch = document.createElement('canvas');
      scratch.width = SAMPLE_W;
      scratch.height = SAMPLE_H;
      const ctx = scratch.getContext('2d');
      if (!ctx) return false;
      ctx.drawImage(canvas, 0, 0, SAMPLE_W, SAMPLE_H);
      const data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
      for (let i = 0; i < data.length; i += 4) {
        // RGB only: an opaque-black cleared buffer has alpha 255 and must
        // not count as rendered content.
        if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0) {
          return true;
        }
      }
      return false;
    },
    undefined,
    { timeout: GPU_PROBE_TIMEOUT_MS, polling: 250 },
  );
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
    // DPR 1 keeps the SwiftShader backing store at 1280×720. CI's 2-core
    // runner software-rasterizes every frame, so the 4× pixel work of DPR 2
    // is pure timeout risk with no assertion value here (non-zero pixel and
    // a differing hash both hold at DPR 1).
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      console.log(`[TEST BROWSER CONSOLE 1] ${msg.type()}: ${msg.text()}`);
    });

    try {
      // agent=true keeps the drawing buffer readable for readPixels below.
      // renderer=webgl pins the path this suite has always tested: under
      // SwiftShader there is no WebGPU so auto-selection always chose WebGL,
      // but on a real local GPU the app auto-selects WebGPU, whose canvas
      // cannot be pixel-probed with drawImage (presented frames are not
      // retained), so the non-zero-pixel waits below would never resolve.
      await page.goto(
        `${SERVER_URL}/?preset=eos-glowsticks-v2-03-music&audio=none&agent=true&renderer=webgl`,
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
      await waitForRenderedContent(page);

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
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      console.log(`[TEST BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
    });

    try {
      // Load first preset. agent=true turns on preserveDrawingBuffer —
      // without it, toDataURL() outside the frame callback reads the
      // cleared (opaque black) buffer, and both captures hash identically
      // no matter what the preset draws. renderer=webgl: see the first test —
      // toDataURL/drawImage cannot read a WebGPU canvas.
      await page.goto(
        `${SERVER_URL}/?preset=eos-glowsticks-v2-03-music&audio=none&agent=true&renderer=webgl`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForSelector('#stims-main', { timeout: 30000 });
      await waitForMountedStage(page);
      await waitForActivePreset(page, 'eos-glowsticks-v2-03-music');
      await page.waitForSelector('.stims-shell__stage-frame canvas', {
        timeout: 30000,
      });
      // Wait for the GPU to produce non-zero output before capturing.
      await waitForRenderedContent(page);

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
      await waitForRenderedContent(page);

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
    await page.goto(`${SERVER_URL}/?audio=none&renderer=webgl`, {
      waitUntil: 'domcontentloaded',
    });
    // The tap must not race the engine-ready layout flip: the moment
    // engineReady enables this card, surrounding elements re-render and the
    // source grid shifts, so a tap dispatched at just-checked coordinates
    // lands on the demo control instead and the flow silently starts demo
    // audio (observed deterministically on the iPhone 13 emulation). Scroll
    // the card into view and wait for its rect to hold still across two
    // polls before tapping.
    const micButton = page.locator('#start-audio-btn');
    await micButton.scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () => {
        const btn = document.querySelector(
          '#start-audio-btn',
        ) as HTMLButtonElement | null;
        if (!btn || btn.disabled) return false;
        const r = btn.getBoundingClientRect();
        const w = window as typeof window & { __micBtnRect?: string };
        const prev = w.__micBtnRect;
        const cur = `${r.x},${r.y},${r.width},${r.height}`;
        w.__micBtnRect = cur;
        return prev === cur;
      },
      undefined,
      { timeout: 30000, polling: 250 },
    );
    await micButton.click();
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

const VT_COUNT_INIT_SCRIPT = `
  const win = window;
  win.__stimsVTCount = 0;
  win.__stimsVTs = [];
  win.__stimsVTDone = () =>
    Promise.all(win.__stimsVTs.map((p) => p.catch(() => {}))).then(() => true);
  const original = document.startViewTransition?.bind(document);
  if (original) {
    document.startViewTransition = (callback) => {
      const transition = original(callback);
      win.__stimsVTCount = (win.__stimsVTCount ?? 0) + 1;
      win.__stimsVTs.push(transition.finished);
      return transition;
    };
  }
`;

async function readVtCount(page: import('playwright').Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as typeof window & { __stimsVTCount?: number }).__stimsVTCount ??
      0,
  );
}

browserTest(
  'home-to-live flip runs a view transition and mounts the live canvas',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: RENDERER_ARGS,
    });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    await ctx.addInitScript(VT_COUNT_INIT_SCRIPT);
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      console.log(`[VT SWAP TEST CONSOLE] ${msg.type()}: ${msg.text()}`);
    });

    try {
      await page.goto(`${SERVER_URL}/?agent=true&renderer=webgl`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('#stims-main', { timeout: 30000 });
      await page.waitForSelector(
        '.stims-shell__stage-frame[data-mode="home"]',
        { timeout: 30000 },
      );
      await page.waitForSelector('.stims-shell__stage-hero', {
        timeout: 30000,
      });

      // Demo audio needs no mic permission. Click() auto-waits for engineReady.
      await page.locator('#use-demo-audio-card').click();

      await page.waitForFunction(
        () => document.body.dataset.audioActive === 'true',
        undefined,
        { timeout: 60000 },
      );
      await page.waitForSelector(
        '.stims-shell__stage-frame[data-mode="live"]',
        { timeout: 30000 },
      );
      await page.waitForSelector('.stims-shell__stage-frame canvas', {
        timeout: 30000,
      });

      // The shell flip is wired to the engine's audioActive edge, so
      // startViewTransition must have fired at least once by now.
      expect(await readVtCount(page)).toBeGreaterThanOrEqual(1);

      // Wait for that transition to finish before flipping back: while a
      // transition is active runViewTransition skips the next one (correct
      // reentrancy behavior), which would make the home-side flip below
      // update directly instead of running its own transition.
      await page.evaluate(() =>
        (
          window as typeof window & {
            __stimsVTDone: () => Promise<boolean>;
          }
        ).__stimsVTDone(),
      );

      // Flip back to home through the app's own route plumbing: dropping the
      // audio param stops audio, which re-crosses the audioActive edge and
      // runs the home-side transition.
      await page.evaluate(() => {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete('audio');
        window.history.pushState(null, '', nextUrl);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.waitForFunction(
        () => document.body.dataset.audioActive !== 'true',
        undefined,
        { timeout: 60000 },
      );
      await page.waitForSelector(
        '.stims-shell__stage-frame[data-mode="home"]',
        { timeout: 30000 },
      );

      expect(await readVtCount(page)).toBeGreaterThanOrEqual(2);
    } finally {
      await closeQuietly(ctx, browser);
    }
  },
  { timeout: 240000 },
);

browserTest(
  'skips the view transition when the OS prefers reduced motion',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: RENDERER_ARGS,
    });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    await ctx.addInitScript(VT_COUNT_INIT_SCRIPT);
    const page = await ctx.newPage();

    try {
      await page.goto(`${SERVER_URL}/?agent=true&renderer=webgl`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('#stims-main', { timeout: 30000 });
      await page.locator('#use-demo-audio-card').click();

      await page.waitForFunction(
        () => document.body.dataset.audioActive === 'true',
        undefined,
        { timeout: 60000 },
      );
      await page.waitForSelector(
        '.stims-shell__stage-frame[data-mode="live"]',
        { timeout: 30000 },
      );

      // Mode flips, but the flip must happen without any view transition.
      expect(await readVtCount(page)).toBe(0);
    } finally {
      await closeQuietly(ctx, browser);
    }
  },
  { timeout: 180000 },
);
