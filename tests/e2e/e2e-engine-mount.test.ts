/**
 * E2E: Verify the engine mounts, loads a preset, and renders canvas content.
 * Uses headed Chromium for real GPU rendering on macOS.
 */
import { afterAll, beforeAll, expect, type test } from 'bun:test';
import { chromium, devices } from 'playwright';
import { writeAgentFailureArtifact } from './agent-api.ts';
import {
  hasChromium,
  localOnlyBrowserTest,
  requiredBrowserTest,
} from './browser-availability.ts';
import { closeQuietly, withDeadline } from './deadline.ts';
import {
  type DevServerHandle,
  isResponsive,
  startDevServer,
} from './dev-server.ts';
import {
  HEADLESS,
  WEBGL_RENDERER_ARGS as RENDERER_ARGS,
} from './webgl-launch.ts';

/**
 * Not every environment installs Playwright browsers — a bare `bun run test`
 * without them makes chromium.launch() fail in milliseconds and read as a
 * product regression. Skip instead, matching agent-integration.
 */
const baseBrowserTest = requiredBrowserTest;

const TEST_PORT = 5181;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

/**
 * Pins the adaptive-quality controller to its cheapest step for these tests.
 *
 * Not a fidelity choice — a latency one. CI renders WebGL through SwiftShader
 * on a small runner, and measured on this box the home page ran at a median
 * frame of 495ms with `setTimeout(0)` taking 407ms to be serviced: the main
 * thread is blocked in ~400ms slabs. Playwright's click() needs that thread
 * several times over (hit-test, dispatch, acknowledge), so clicks queued
 * behind those slabs and blew whatever deadline they were given. Locking the
 * step roughly halves it (median 240ms), which buys the input path enough
 * room without changing the viewport, and so without moving any responsive
 * breakpoint these tests assert against.
 */
const CHEAP_RENDER_PARAMS = 'lockQualityStep=6';

// Launching a browser carries no timeout of its own, and it is the call that
// fails first when the runner is out of headroom.
const LAUNCH_TIMEOUT_MS = 60_000;
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

/**
 * Waits for the milkdrop runtime to mount and, for a boot preset requested
 * via the `?preset=` URL, to have finished applying it — window.stims.agent
 * .ready() already waits out the runtime's own startup preset selection
 * (see agent-driver.ts), which used to race a caller's own DOM poll here
 * closely enough to make "did the boot preset actually land yet" genuinely
 * ambiguous. Only good for the *initial* preset; a preset changed afterward
 * (route push, popstate) needs waitForActivePreset below instead.
 */
async function waitForMountedStage(page: import('playwright').Page) {
  await page.waitForSelector('#stims-main', { timeout: 30000 });
  await page.evaluate(() => window.stims?.agent?.ready({ timeoutMs: 55000 }));
  await page.waitForSelector('.stims-shell__stage-frame canvas', {
    timeout: 30000,
  });
}

/**
 * Waits for a preset change that happens outside stims.agent's own
 * selectPreset — a route push + popstate, in these tests — by polling the
 * same authoritative engine state selectPreset checks, instead of two
 * separate DOM queries (the data-active-preset-id attribute and canvas
 * presence, checked independently before).
 */
async function waitForActivePreset(
  page: import('playwright').Page,
  presetId: string,
) {
  await page.evaluate(
    (id) => window.stims?.agent?.waitForPreset(id, { timeoutMs: 55000 }),
    presetId,
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

/**
 * Re-checks the shared dev server before each test, restarting it when it has
 * stopped answering.
 *
 * This suite used to start vite once in `beforeAll` and assume it survived the
 * whole file. It does not always: the run launches a fresh Chromium per test
 * against a dev server that stays up for minutes, and when vite dies partway
 * the remaining tests fail with a bare `ERR_CONNECTION_REFUSED` naming only
 * the URL — a message that describes the symptom and hides the cause. The
 * probe is bounded (see isResponsive) so a wedged server is treated the same
 * as a dead one instead of hanging the test that found it.
 */
async function ensureDevServer() {
  if (!devServer) {
    await startServer();
    return;
  }
  if (await isResponsive(SERVER_URL)) return;
  await stopServer();
  await startServer();
}

/** Wraps every browser test so the server guard above cannot be forgotten. */
/**
 * One Chromium for the tests that launch it identically, a fresh context each.
 *
 * This file launched a browser per test — five on a 2-core SwiftShader runner,
 * and `home-to-live flip` is the fourth. That is why its stall kept moving
 * (`await stage-hero` at 30s one run, `open audio disclosure` at 90s the next)
 * without any of its own waits being wrong: by the time it ran, the machine
 * was carrying the remains of three other browsers. The sibling suite showed
 * the end state of the same pattern, failing outright with
 * `Timed out after 60000ms while launching Chromium`.
 *
 * A context already gives these tests the isolation they use — viewport,
 * reduced-motion, init scripts, storage — so the process is shared and only
 * the context is per-test. The microphone test keeps its own browser: its
 * fake-media-stream flags are process-level, not context-level.
 */
let sharedBrowser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

async function releaseSharedBrowser() {
  if (!sharedBrowser) return;
  const browser = sharedBrowser;
  sharedBrowser = null;
  await closeQuietly(browser);
}

async function sharedRendererBrowser() {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  sharedBrowser = await withDeadline(
    chromium.launch({ headless: HEADLESS, args: RENDERER_ARGS }),
    LAUNCH_TIMEOUT_MS,
    'launching the shared Chromium',
  );
  return sharedBrowser;
}

function browserTest(
  name: string,
  body: () => Promise<void>,
  options?: Parameters<typeof test>[2],
) {
  return baseBrowserTest(
    name,
    async () => {
      await ensureDevServer();
      await body();
    },
    options,
  );
}

beforeAll(() => startServer(), { timeout: 60000 });
/**
 * 30s, not bun's 5s default for a hook.
 *
 * This teardown does two slow things — it shuts down a Chromium that has been
 * software-rasterizing WebGL frames, then stops vite — while `beforeAll` above
 * only starts vite and was still given 60s. That asymmetry was the bug: on the
 * 2-core runner the close ran past 5s, bun cut the hook, and the whole job
 * failed red with all six tests passing, leaving an orphaned
 * `chrome-headless-shell` behind for the runner to reap.
 *
 * 30s matches what the two sibling suites that also close a browser here
 * (`agent-integration`, `chrome-visual-contract`) already use; the suites left
 * on the default only stop a server, which is cheap.
 */
afterAll(async () => {
  await releaseSharedBrowser();
  await stopServer();
}, 30000);

browserTest(
  'mounts engine, loads preset, and renders a silent preview frame',
  async () => {
    const browser = await sharedRendererBrowser();
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

      // A preset route mounts the runtime preview without inventing an audio
      // source. This also covers the #stims-main / canvas presence checks
      // that used to be separate waits — ready() only resolves once the
      // shell has mounted and the boot preset from the URL has actually
      // applied (see agent-driver.ts's startupSettled).
      await waitForMountedStage(page);

      const shell = await page.$('#stims-main');
      expect(shell).not.toBeNull();
      const canvas = await page.$('.stims-shell__stage-frame canvas');
      expect(canvas).not.toBeNull();

      // ready() already guarantees the boot preset settled; read the state
      // once rather than polling for it.
      const bootPresetId = await page.evaluate(
        () => window.stims?.agent?.state().presetId,
      );
      expect(bootPresetId).toBe('eos-glowsticks-v2-03-music');

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
    } catch (error) {
      await writeAgentFailureArtifact(
        page,
        'e2e-engine-mount-mounts-engine-loads-preset-renders-preview-frame',
      );
      throw error;
    } finally {
      await closeQuietly(ctx);
    }
  },
  { timeout: 240000 },
);

browserTest(
  'switches preset and canvas content changes',
  async () => {
    const browser = await sharedRendererBrowser();
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
      await waitForMountedStage(page);
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
      // The canvas element itself persists across an in-place preset switch
      // under a pinned renderer=webgl (only a WebGPU-fallback swap replaces
      // it) — no need to re-wait for its presence, just the state change.
      await waitForActivePreset(page, 'rovastar-parallel-universe');

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
    } catch (error) {
      await writeAgentFailureArtifact(
        page,
        'e2e-engine-mount-switches-preset-and-canvas-content-changes',
      );
      throw error;
    } finally {
      await closeQuietly(ctx);
    }
  },
  { timeout: 240000 },
);

/**
 * Waits for the home page's audio-source chips.
 *
 * Every variant of the launch page renders the alternatives to the primary
 * CTA (mic, tab, file, YouTube) as a row of chips with no disclosure around
 * them, so there is nothing to open — but they come from the lazily-imported
 * NewHomePage chunk, which a cold vite dev server on a 2-vCPU runner can take
 * a while to transform. Waiting on `.stims-shell__stage-hero` does not cover
 * it: the shell renders the hero before the chunk resolves, and an immediate
 * locator count() on a `domcontentloaded` page returns 0.
 */
async function waitForAudioSources(
  page: import('playwright').Page,
  { attachTimeoutMs = 90000 }: { attachTimeoutMs?: number } = {},
) {
  try {
    await page
      .locator('.stims-shell__source-grid--chips')
      .first()
      .waitFor({ state: 'attached', timeout: attachTimeoutMs });
  } catch {
    throw new Error(
      'The audio-source chips never appeared. They live inside the lazy ' +
        'NewHomePage chunk, so this usually means that chunk failed or was ' +
        'still loading — not that the chips are missing from the markup.',
    );
  }
}

async function verifySmartphoneMicrophoneAccess({
  returningUser,
}: {
  returningUser: boolean;
}) {
  // This one cannot share: fake-media-stream is a process-level flag. Drop the
  // shared browser first so only one is ever alive — leaving both up put two
  // SwiftShader processes on the runner at once, which is the contention this
  // whole change exists to remove. `sharedRendererBrowser()` re-launches on
  // demand if a later test needs it.
  await releaseSharedBrowser();
  const browser = await withDeadline(
    chromium.launch({
      headless: HEADLESS,
      args: [
        ...RENDERER_ARGS,
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    }),
    LAUNCH_TIMEOUT_MS,
    'launching Chromium with a fake media stream',
  );
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
    // 90s of attach wait exists for a cold vite dev server on CI. These two
    // tests are localOnlyBrowserTest, so they never run there; on a dev box
    // the chunk is ready in well under 20s, and the shorter wait keeps the
    // worst-case sum below this test's budget.
    await waitForAudioSources(page, { attachTimeoutMs: 20000 });
    const micButton = page.locator('[data-mic-audio-btn]');
    await micButton.scrollIntoViewIfNeeded({ timeout: 15000 });
    await page.waitForFunction(
      () => {
        const btn = document.querySelector(
          '[data-mic-audio-btn]',
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
    await micButton.click({ timeout: 30000 });
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

    const info = await withDeadline(
      page.evaluate(() => {
        const state = window as typeof window & {
          __stimsMicCalls?: number;
          __stimsMicConstraints?: MediaStreamConstraints;
        };
        return {
          calls: state.__stimsMicCalls ?? 0,
          constraints: state.__stimsMicConstraints,
          route: window.location.search,
        };
      }),
      15000,
      'reading the recorded getUserMedia calls back out of the page',
    );

    expect(info.calls).toBe(1);

    // Two separate intents live in this constraint set, both defined in
    // src/js/core/audio-constants.ts:
    //
    // 1. The browser's voice-call DSP must be OFF. The visualizer reacts to
    //    the raw spectrum, and automatic gain control normalises away
    //    exactly the dynamics every beat-driven preset keys off — a
    //    gain-controlled feed looks fine while the presets quietly stop
    //    moving with the music, and nothing downstream can tell a
    //    compressed mix from a quiet one. Echo cancellation and noise
    //    suppression eat the low end and duck the signal against room
    //    sound. Asked for with `exact` (not `ideal`) so a platform that
    //    will not honour it throws OverconstrainedError, which
    //    acquireMicrophoneStream catches and retries with the soft `ideal`
    //    form, rather than silently applying the DSP.
    // 2. More than stereo is *preferred*, so an audio interface's extra
    //    channels survive for the cue-bus selection. That one stays
    //    `ideal` on purpose — `exact` would fail outright on a phone or
    //    laptop mic, which is precisely the device under test here.
    const audioConstraints = info.constraints?.audio as
      | MediaTrackConstraints
      | undefined;
    expect(audioConstraints).toBeTypeOf('object');

    // Whichever of the two attempts was recorded, every processor is turned
    // off; the first attempt (the only one here — see the calls check
    // above) uses the hard form.
    for (const flag of [
      'echoCancellation',
      'noiseSuppression',
      'autoGainControl',
    ] as const) {
      const value = audioConstraints?.[flag] as
        | ConstrainBooleanParameters
        | undefined;
      expect(value, `${flag} must be constrained off`).toBeTypeOf('object');
      expect(value?.exact ?? value?.ideal, `${flag} must be false`).toBe(false);
    }
    expect(audioConstraints).toMatchObject({
      echoCancellation: { exact: false },
      noiseSuppression: { exact: false },
      autoGainControl: { exact: false },
    });

    // Multichannel is a preference, never a requirement.
    const channelCount = audioConstraints?.channelCount as
      | ConstrainULongRange
      | undefined;
    expect(channelCount?.ideal).toBeGreaterThan(2);
    expect(channelCount).not.toHaveProperty('exact');
    expect(channelCount).not.toHaveProperty('min');

    expect(audioConstraints).not.toHaveProperty('deviceId');

    expect(info.route).toContain('audio=microphone');
  } catch (error) {
    await writeAgentFailureArtifact(
      page,
      `e2e-engine-mount-smartphone-mic-access-${returningUser ? 'returning' : 'first-time'}-user`,
    );
    throw error;
  } finally {
    await closeQuietly(ctx, browser);
  }
}

const smartphoneMicrophoneTest = localOnlyBrowserTest;

smartphoneMicrophoneTest(
  'requests default microphone access for a first-time smartphone user',
  () => verifySmartphoneMicrophoneAccess({ returningUser: false }),
  // The budget has to exceed the sum of every deadline inside, or the outer
  // timeout wins the race and buries the named error — the exact opaque
  // failure the deadlines in this file exist to remove. Sequential worst
  // case, once every call in this path is bounded:
  //
  //   disclosure attach 20 + read .open 15 + scrollIntoView 15
  //   + stabilise 30 + click 30 + audioActive 30 + route 30 + read back 15
  //   + failure dump 30 + teardown 30                        = 245s
  //
  // 300s leaves margin. That is not a licence to hang: every step above
  // fails at its own deadline with a message naming it, so this backstop
  // should never actually be reached. It exists so the first real error
  // wins, which is the whole point.
  //
  // Two review passes were needed to get this right — #1138 raised the
  // disclosure wait without re-checking the budget, and the first fix
  // counted only the disclosure, dump and teardown while three calls in
  // here were still unbounded. Recompute the sum when changing any of them.
  { timeout: 300000 },
);

smartphoneMicrophoneTest(
  'reuses granted microphone access for a returning smartphone user',
  () => verifySmartphoneMicrophoneAccess({ returningUser: true }),
  // Same 245s worst-case sum as its sibling above.
  { timeout: 300000 },
);

browserTest(
  'home-to-live flip mounts the live canvas and returns home',
  async () => {
    const browser = await sharedRendererBrowser();
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      console.log(`[FLIP TEST CONSOLE] ${msg.type()}: ${msg.text()}`);
    });

    // This test only reproduces on CI, where the page produces no console
    // output beyond React's mount message — so the log cannot show which wait
    // is the one that stalls. Name each step as it starts; the last line
    // printed is the step that did not finish.
    const step = (name: string) => {
      console.log(`[FLIP STEP] ${name}`);
    };

    try {
      step('goto');
      await page.goto(
        `${SERVER_URL}/?agent=true&renderer=webgl&${CHEAP_RENDER_PARAMS}`,
        {
          waitUntil: 'domcontentloaded',
        },
      );
      step('await #stims-main');
      await page.waitForSelector('#stims-main', { timeout: 30000 });
      step('await stage-frame[data-mode=home]');
      await page.waitForSelector(
        '.stims-shell__stage-frame[data-mode="home"]',
        { timeout: 30000 },
      );
      step('await stage-hero');
      await page.waitForSelector('.stims-shell__stage-hero', {
        timeout: 30000,
      });

      // Demo audio needs no mic permission. Click() auto-waits for engineReady.
      step('await audio sources');
      await waitForAudioSources(page);
      step('click demo-audio');
      // click() carries no deadline of its own, so a card that never becomes
      // actionable used to consume the whole test budget and report a timeout
      // naming no cause. 30s, not more: raising this to 90s was tried and
      // changed nothing, which is itself the useful result — when this fails
      // the card is absent rather than slow (Playwright's call log stops at
      // "waiting for locator", never resolving it), so waiting longer only
      // buys a later identical failure. See #1123.
      // Play demo is the launch page's primary button; there is no separate
      // demo card among the sources.
      await page
        .locator('.stims-shell__launch-cta[data-demo-audio-btn]')
        .click({ timeout: 30000 });

      step('await audioActive=true');
      await page.waitForFunction(
        () => document.body.dataset.audioActive === 'true',
        undefined,
        { timeout: 60000 },
      );
      step('await stage-frame[data-mode=live]');
      await page.waitForSelector(
        '.stims-shell__stage-frame[data-mode="live"]',
        { timeout: 30000 },
      );
      step('await live canvas');
      await page.waitForSelector('.stims-shell__stage-frame canvas', {
        timeout: 30000,
      });

      // Flip back to home through the app's own route plumbing: dropping the
      // audio param stops audio, which re-crosses the audioActive edge the
      // shell swap is wired to.
      await page.evaluate(() => {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete('audio');
        window.history.pushState(null, '', nextUrl);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      step('await audioActive!=true');
      await page.waitForFunction(
        () => document.body.dataset.audioActive !== 'true',
        undefined,
        { timeout: 60000 },
      );
      step('await stage-frame[data-mode=home] (return)');
      await page.waitForSelector(
        '.stims-shell__stage-frame[data-mode="home"]',
        { timeout: 30000 },
      );
    } catch (error) {
      await writeAgentFailureArtifact(
        page,
        'e2e-engine-mount-home-to-live-flip',
      );
      throw error;
    } finally {
      await closeQuietly(ctx);
    }
  },
  { timeout: 240000 },
);

/**
 * Not in the starter catalog, so its catalog entry — and the artwork the
 * launch header shows for it — resolves only once the full catalog lands.
 */
const LATE_RESOLVING_PRESET = 'stahlregen-geiss-old-school-baby-flower-v2-1';

type DeepLinkRecord = {
  /** Times the generic first-visit tagline was in the React page. */
  generic: number[];
  /** Layout shifts, and whether any source sat in the launch column. */
  shifts: { at: number; launch: boolean }[];
  /** When the body first reported a live audio session. */
  liveAt: number | null;
};

browserTest(
  'a deep link names its preset until the stage takes over, without shifting',
  async () => {
    const browser = await sharedRendererBrowser();
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 823 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    // Two regressions on the ?preset= arrival, both seen from outside:
    // - the header dropped to the generic first-visit pitch on the first
    //   render after auto-start, so the pitch showed while the engine booted
    //   and again under the stage's fade (that late paint was the page's
    //   largest contentful paint);
    // - the preset's artwork was inserted when the catalog resolved it,
    //   pushing the buttons and note down (a 0.05-0.15 layout shift).
    await page.addInitScript(() => {
      const record: DeepLinkRecord = { generic: [], shifts: [], liveAt: null };
      (window as unknown as { __deepLink: DeepLinkRecord }).__deepLink = record;
      const check = () => {
        for (const el of document.querySelectorAll(
          '#app .stims-shell__launch-tagline',
        )) {
          if (el.textContent?.startsWith('Thousands of presets for MilkDrop')) {
            record.generic.push(performance.now());
          }
        }
        if (
          record.liveAt === null &&
          document.body?.dataset.audioActive === 'true'
        ) {
          record.liveAt = performance.now();
        }
      };
      new MutationObserver(check).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-audio-active'],
      });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          startTime: number;
          sources?: { node?: Node | null }[];
        }[]) {
          const launch = (entry.sources ?? []).some((source) => {
            const node = source.node;
            const el = node instanceof Element ? node : node?.parentElement;
            return Boolean(el?.closest('.stims-shell__launch-center'));
          });
          record.shifts.push({ at: entry.startTime, launch });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });

    try {
      await page.goto(
        `${SERVER_URL}/?preset=${LATE_RESOLVING_PRESET}&renderer=webgl&${CHEAP_RENDER_PARAMS}`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForSelector(
        '.stims-shell__launch-center[data-variant="deep-link"]',
        { timeout: 30000 },
      );
      await page.waitForFunction(
        () => document.body.dataset.audioActive === 'true',
        undefined,
        { timeout: 120000 },
      );
      // Past the launch column's fade under the stage, where the generic
      // pitch used to paint.
      await page.waitForFunction(
        () => {
          const launch = document.querySelector('.stims-shell__launch');
          return launch !== null && getComputedStyle(launch).opacity === '0';
        },
        undefined,
        { timeout: 30000 },
      );

      const record = await page.evaluate(
        () => (window as unknown as { __deepLink: DeepLinkRecord }).__deepLink,
      );
      expect(record.liveAt).not.toBeNull();
      expect(record.generic).toEqual([]);
      const launchShiftsBeforeLive = record.shifts.filter(
        (shift) => shift.launch && shift.at < (record.liveAt ?? 0),
      );
      expect(launchShiftsBeforeLive).toEqual([]);
    } catch (error) {
      await writeAgentFailureArtifact(page, 'e2e-engine-mount-deep-link-hold');
      throw error;
    } finally {
      await closeQuietly(ctx);
    }
  },
  { timeout: 240000 },
);
