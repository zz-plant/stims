/**
 * E2E: the layouts a half-folded screen gets.
 *
 * Chromium's DevTools protocol reports a real hinge to the page, with
 * `window.viewport.segments` and the `*-viewport-segments` media queries
 * matching, so these run the shipped stylesheets against one. The geometry is
 * iPhone Duo's published viewports (tests/fixtures/responsive-scenarios.ts) and
 * one estimated for a flip phone turned sideways; the hinge positions are
 * chosen for the test, since no vendor publishes them. A real device can still
 * differ: this proves the layout follows the hinge it is told about.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { type Browser, chromium, type Page } from 'playwright';
import { findResponsiveScenario } from '../fixtures/responsive-scenarios.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5347;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEST_TIMEOUT = 120000;
/** A phone browser, so the app takes its touch paths on the WebGL backend. */
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36';

type Viewport = { width: number; height: number };
type Hinge = {
  orientation: 'horizontal' | 'vertical';
  offset: number;
  maskLength: number;
};

const LAPTOP_VIEWPORT = findResponsiveScenario('medium-portrait').viewport;
const LAPTOP_HINGE: Hinge = {
  orientation: 'horizontal',
  offset: 423,
  maskLength: 20,
};
const LOWER_SEGMENT_TOP = 443;

const BOOK_VIEWPORT = findResponsiveScenario('wide-short').viewport;
const BOOK_HINGE: Hinge = {
  orientation: 'vertical',
  offset: 465,
  maskLength: 20,
};
const RIGHT_SEGMENT_LEFT = 485;

let devServer: DevServerHandle | null = null;
let browser: Browser | null = null;

beforeAll(
  async () => {
    if (!hasChromium) return;
    devServer = await startDevServer({ port: TEST_PORT });
    browser = await chromium.launch({
      headless: HEADLESS,
      args: WEBGL_RENDERER_ARGS,
    });
  },
  { timeout: 60000 },
);

afterAll(async () => {
  if (browser) await closeQuietly(browser);
  browser = null;
  const server = devServer;
  devServer = null;
  await server?.stop();
}, 30000);

type AgentWindow = Window & {
  __stims_agent: {
    getState: () => { engineState: string; presetId: string | null };
    run: (action: string) => Promise<unknown>;
  };
};

async function openPhone(
  viewport: Viewport,
  options: { screen?: Viewport; colorScheme?: 'light' | 'dark' } = {},
): Promise<Page> {
  const context = await (browser as Browser).newContext({
    viewport,
    screen: options.screen ?? viewport,
    colorScheme: options.colorScheme ?? 'dark',
    hasTouch: true,
    isMobile: true,
    userAgent: ANDROID_CHROME,
  });
  const page = await context.newPage();
  await page.goto(`${SERVER_URL}/?agent=true&mockAudio=demo&renderer=webgl`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () => Boolean((window as unknown as AgentWindow).__stims_agent),
    undefined,
    { timeout: 60000 },
  );
  return page;
}

async function goLive(page: Page) {
  await page.evaluate(() =>
    (window as unknown as AgentWindow).__stims_agent.run('audio-demo'),
  );
  await page.waitForFunction(
    () =>
      (window as unknown as AgentWindow).__stims_agent.getState()
        .engineState === 'live',
    undefined,
    { timeout: 60000 },
  );
  await page.waitForSelector('#stims-visualizer canvas', { timeout: 30000 });
}

/**
 * Not `setDisplayFeaturesOverride`, which answers ok and leaves one segment.
 * `page.screenshot` resets this override, so nothing here takes one.
 */
async function setHinge(page: Page, viewport: Viewport, hinge: Hinge | null) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: true,
    ...(hinge
      ? { displayFeature: hinge, devicePosture: { type: 'folded' } }
      : { devicePosture: { type: 'continuous' } }),
  });
  const segments = hinge ? 2 : 1;
  await page.waitForFunction(
    (expected) =>
      (window as unknown as { viewport: { segments: unknown[] } }).viewport
        .segments.length === expected,
    segments,
  );
}

const box = (page: Page, selector: string) =>
  page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) return null;
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return { left, top, right, bottom };
  }, selector);

const canvasBuffer = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '#stims-visualizer canvas',
    );
    return canvas ? { width: canvas.width, height: canvas.height } : null;
  });

const STAGE = '#stims-visualizer';
const DIALOG = '[data-shell-dialog]';

async function openPanel(page: Page, action: string) {
  await page.evaluate(
    (id) => (window as unknown as AgentWindow).__stims_agent.run(id),
    action,
  );
  await page.waitForSelector(DIALOG, { timeout: 30000 });
}

async function closePanel(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForSelector(DIALOG, { state: 'detached', timeout: 30000 });
}

requiredBrowserTest(
  'laptop pose: the stage takes the upper half at that shape, panels the lower',
  async () => {
    const page = await openPhone(LAPTOP_VIEWPORT);
    try {
      await goLive(page);
      await setHinge(page, LAPTOP_VIEWPORT, LAPTOP_HINGE);

      await page.waitForFunction(
        (selector) => {
          const canvas = document.querySelector<HTMLCanvasElement>(selector);
          return canvas !== null && canvas.width > canvas.height;
        },
        `${STAGE} canvas`,
        { timeout: 30000 },
      );
      expect((await box(page, STAGE))?.bottom).toBe(LAPTOP_HINGE.offset);
      const buffer = await canvasBuffer(page);

      for (const action of ['open-editor', 'open-browse']) {
        await openPanel(page, action);
        const panel = await box(page, DIALOG);
        expect(panel?.top).toBe(LOWER_SEGMENT_TOP);
        expect(panel?.bottom).toBe(LAPTOP_VIEWPORT.height);
        expect(panel?.left).toBe(0);
        expect(panel?.right).toBe(LAPTOP_VIEWPORT.width);
        // Above the panel already: no lift, and no resize restarting feedback.
        expect((await box(page, STAGE))?.top).toBe(0);
        expect(await canvasBuffer(page)).toEqual(buffer);
        await closePanel(page);
      }
    } finally {
      await page.context().close();
    }
  },
  TEST_TIMEOUT,
);

requiredBrowserTest(
  'laptop pose: opening the device flat gives the whole screen back',
  async () => {
    const page = await openPhone(LAPTOP_VIEWPORT);
    try {
      await goLive(page);
      await setHinge(page, LAPTOP_VIEWPORT, LAPTOP_HINGE);
      await setHinge(page, LAPTOP_VIEWPORT, null);

      expect((await box(page, STAGE))?.bottom).toBe(LAPTOP_VIEWPORT.height);
      await openPanel(page, 'open-editor');
      const panel = await box(page, DIALOG);
      // The flat phone sheet: taller than the hinge's half, ending at 40rem.
      expect(panel?.top).toBeLessThan(LOWER_SEGMENT_TOP);
    } finally {
      await page.context().close();
    }
  },
  TEST_TIMEOUT,
);

requiredBrowserTest(
  'book pose: panels take the right half and the visual centres in the left',
  async () => {
    const page = await openPhone(BOOK_VIEWPORT);
    try {
      await goLive(page);
      await setHinge(page, BOOK_VIEWPORT, BOOK_HINGE);

      // One canvas across the hinge until a panel needs the room.
      const whole = await box(page, STAGE);
      expect(whole?.left).toBe(0);
      expect(whole?.right).toBe(BOOK_VIEWPORT.width);
      const buffer = await canvasBuffer(page);

      await openPanel(page, 'open-editor');
      const panel = await box(page, DIALOG);
      expect(panel?.left).toBe(RIGHT_SEGMENT_LEFT);
      expect(panel?.right).toBe(BOOK_VIEWPORT.width);
      expect(panel?.top).toBe(0);
      expect(panel?.bottom).toBe(BOOK_VIEWPORT.height);

      const lifted = await box(page, STAGE);
      const centre = ((lifted?.left ?? 0) + (lifted?.right ?? 0)) / 2;
      expect(Math.abs(centre - BOOK_HINGE.offset / 2)).toBeLessThanOrEqual(
        BOOK_HINGE.maskLength,
      );
      expect(await canvasBuffer(page)).toEqual(buffer);
    } finally {
      await page.context().close();
    }
  },
  TEST_TIMEOUT,
);

requiredBrowserTest(
  'book pose: every dock control stays on the left of the hinge',
  async () => {
    const page = await openPhone(BOOK_VIEWPORT);
    try {
      await goLive(page);
      await setHinge(page, BOOK_VIEWPORT, BOOK_HINGE);
      await page.mouse.move(100, 100);
      const dock = page.locator('[class*="_bar_"][data-visible="true"]');
      await dock.waitFor({ state: 'visible', timeout: 30000 });

      const outside = await dock.evaluate((bar, limit) => {
        const stray: string[] = [];
        for (const button of bar.querySelectorAll('button')) {
          const { left, right, width } = button.getBoundingClientRect();
          if (width > 0 && (left < 0 || right > limit)) {
            stray.push(button.getAttribute('aria-label') ?? button.className);
          }
        }
        return stray;
      }, BOOK_HINGE.offset);
      expect(outside).toEqual([]);
    } finally {
      await page.context().close();
    }
  },
  TEST_TIMEOUT,
);

requiredBrowserTest(
  'book pose: a phone turned sideways keeps Browse open while a card plays',
  async () => {
    // Flat, this viewport counts as a phone sheet covering the stage, so a
    // tapped card plays and closes it. The hinge leaves the stage in view.
    const viewport = { width: 915, height: 412 };
    const page = await openPhone(viewport);
    try {
      await goLive(page);
      await setHinge(page, viewport, {
        orientation: 'vertical',
        offset: 447,
        maskLength: 20,
      });
      await openPanel(page, 'open-browse');
      const started = await page.evaluate(
        () =>
          (window as unknown as AgentWindow).__stims_agent.getState().presetId,
      );

      await page
        .locator(`${DIALOG} a[data-preset-id][data-active="false"]`)
        .first()
        .tap({ timeout: 30000 });
      await page.waitForFunction(
        (before) =>
          (window as unknown as AgentWindow).__stims_agent.getState()
            .presetId !== before,
        started,
        { timeout: 30000 },
      );
      expect(await box(page, DIALOG)).not.toBeNull();
    } finally {
      await page.context().close();
    }
  },
  TEST_TIMEOUT,
);

const ROTATE_HINT = '.stims-shell__rotate-hint';
const rotateHint = (page: Page) =>
  page.locator(ROTATE_HINT, { hasText: 'Rotate your phone' });

type HintWindow = Window & { __rotateHintSeen?: boolean };

/**
 * Notes a rotate hint arriving at any point from here on. The hint leaves
 * 4200 ms after it comes, and `goLive` can return later than that on a slow
 * runner, so looking at the page afterwards cannot tell "never shown" from
 * "already gone".
 */
const watchForRotateHint = (page: Page) =>
  page.evaluate((selector) => {
    const record = window as unknown as HintWindow;
    record.__rotateHintSeen = false;
    new MutationObserver((_, observer) => {
      if (document.querySelector(selector)) {
        record.__rotateHintSeen = true;
        observer.disconnect();
      }
    }).observe(document.body, { childList: true, subtree: true });
  }, ROTATE_HINT);

requiredBrowserTest(
  'the rotate hint shows for a window filling the screen',
  async () => {
    const page = await openPhone(LAPTOP_VIEWPORT);
    try {
      // Together, not one after the other: the hint can come and go before
      // `goLive` returns (see watchForRotateHint).
      await Promise.all([
        rotateHint(page).waitFor({ state: 'visible', timeout: 60000 }),
        goLive(page),
      ]);
    } finally {
      await page.context().close();
    }
  },
  TEST_TIMEOUT,
);

requiredBrowserTest(
  'the rotate hint stays away from a window sharing the screen',
  async () => {
    const page = await openPhone(
      findResponsiveScenario('split-window').viewport,
      {
        screen: { width: 951, height: 585 },
      },
    );
    try {
      await watchForRotateHint(page);
      await goLive(page);
      expect(
        await page.evaluate(
          () => (window as unknown as HintWindow).__rotateHintSeen,
        ),
      ).toBe(false);
    } finally {
      await page.context().close();
    }
  },
  TEST_TIMEOUT,
);

requiredBrowserTest(
  'a short sideways window shows Start visualizer without scrolling',
  async () => {
    const viewport = { width: 594, height: 368 };
    const page = await openPhone(viewport);
    try {
      const start = page.getByRole('button', { name: 'Start visualizer' });
      await start.waitFor({ state: 'visible', timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      const position = await start.boundingBox();
      expect((position?.y ?? 0) + (position?.height ?? 0)).toBeLessThanOrEqual(
        viewport.height,
      );
    } finally {
      await page.context().close();
    }
  },
  TEST_TIMEOUT,
);

requiredBrowserTest(
  'the page background is the dark stage on a light system too',
  async () => {
    // Safari paints this colour beside its side controls on iPhone Duo's outer
    // display. It has to be the stage floor, not the light theme's page.
    const page = await openPhone(BOOK_VIEWPORT, { colorScheme: 'light' });
    try {
      const colour = await page.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      );
      expect(colour).toBe('rgb(10, 10, 9)');
    } finally {
      await page.context().close();
    }
  },
  TEST_TIMEOUT,
);
