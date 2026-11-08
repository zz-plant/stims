/**
 * E2E: how many actions the common goals take.
 *
 * Each case walks one goal on the real app and counts what a visitor does,
 * using only controls on screen at that moment. A flow that grows a step fails
 * here, so it has to be argued for instead of arriving unnoticed. Waiting does
 * not count as a step.
 *
 * Not in agent mode: the dock's folding and the first-use hints are what is
 * being counted.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { type Browser, chromium, type Page } from 'playwright';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5299;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 720 };

let devServer: DevServerHandle | null = null;

beforeAll(
  async () => {
    if (!hasChromium) return;
    devServer = await startDevServer({ port: TEST_PORT });
  },
  { timeout: 60000 },
);

afterAll(async () => {
  const server = devServer;
  devServer = null;
  await server?.stop();
}, 30000);

type AgentState = {
  presetId: string | null;
  audioActive?: boolean;
  audioSource?: string | null;
};

const agentState = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __stims_agent: { getState: () => AgentState };
        }
      ).__stims_agent.getState() as AgentState,
  );

const waitForPresetOtherThan = (page: Page, presetId: string | null) =>
  page.waitForFunction(
    (previous) => {
      const state = (
        window as unknown as {
          __stims_agent: { getState: () => AgentState };
        }
      ).__stims_agent.getState();
      return state.presetId !== null && state.presetId !== previous;
    },
    presetId,
    { timeout: 60000 },
  );

/** Counts what the visitor does. Waiting for the page is not a step. */
function stepCounter() {
  let steps = 0;
  return {
    step: async (action: () => Promise<unknown>) => {
      steps += 1;
      await action();
    },
    count: () => steps,
  };
}

async function withPage(
  viewport: { width: number; height: number },
  touch: boolean,
  run: (page: Page) => Promise<void>,
) {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: HEADLESS,
      args: WEBGL_RENDERER_ARGS,
    });
    const context = await browser.newContext({
      viewport,
      hasTouch: touch,
      isMobile: touch,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(`${SERVER_URL}/?mockAudio=demo&renderer=webgl`, {
      waitUntil: 'domcontentloaded',
    });
    await run(page);
  } finally {
    if (browser) await closeQuietly(browser);
  }
}

const startButton = (page: Page) =>
  page.getByRole('button', { name: 'Start visualizer' }).first();

async function startDemo(page: Page) {
  await startButton(page).waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          __stims_agent?: { getState: () => { engineReady?: boolean } };
        }
      ).__stims_agent?.getState().engineReady === true,
    undefined,
    { timeout: 60000 },
  );
  await startButton(page).click();
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          __stims_agent: { getState: () => { presetId: string | null } };
        }
      ).__stims_agent.getState().presetId !== null,
    undefined,
    { timeout: 60000 },
  );
}

const browseDialog = (page: Page) =>
  page.getByRole('dialog', { name: /browse/i });

/** Cards other than the one playing, since picking that one closes Browse. */
const otherTiles = (page: Page) =>
  browseDialog(page).locator('a[data-preset-id][data-active="false"]');

/** The folded dock's Next, on screen once the bar has folded by itself. */
const foldedNext = (page: Page) =>
  page.locator('button[data-action="next-preset"][data-visible="true"]');

requiredBrowserTest(
  'phone: each tap on the folded dock changes the preset',
  async () => {
    await withPage(PHONE, true, async (page) => {
      await startDemo(page);
      await foldedNext(page).waitFor({ state: 'visible', timeout: 20000 });
      const before = (await agentState(page)).presetId;

      const spot = await foldedNext(page).boundingBox();
      if (!spot) throw new Error('Next has no box');
      const x = spot.x + spot.width / 2;
      const y = spot.y + spot.height / 2;

      const { step, count } = stepCounter();
      await step(() => page.touchscreen.tap(x, y));
      await waitForPresetOtherThan(page, before);
      const second = (await agentState(page)).presetId;

      // The same spot keeps meaning Next: nothing unfolds under the thumb.
      await step(() => page.touchscreen.tap(x, y));
      await waitForPresetOtherThan(page, second);

      expect(count()).toBe(2);
      expect(await foldedNext(page).isVisible()).toBe(true);
    });
  },
  { timeout: 180000 },
);

requiredBrowserTest(
  'desktop: comparing three presets in Browse takes four actions',
  async () => {
    await withPage(DESKTOP, false, async (page) => {
      await startDemo(page);
      const { step, count } = stepCounter();
      await step(() => page.keyboard.press('b'));
      await otherTiles(page).nth(3).waitFor({
        state: 'visible',
        timeout: 30000,
      });

      for (const index of [0, 1, 2]) {
        const before = (await agentState(page)).presetId;
        const tile = otherTiles(page).nth(index);
        const id = await tile.getAttribute('data-preset-id');
        const top = (await tile.boundingBox())?.y;
        await step(() => tile.click());
        await waitForPresetOtherThan(page, before);
        await expect(browseDialog(page).isVisible()).resolves.toBe(true);
        // The cards hold still, or the next click would land on another one.
        const moved = await browseDialog(page)
          .locator(`a[data-preset-id="${id}"]`)
          .boundingBox();
        // A few pixels are a card's own hover and press styling.
        expect(Math.abs((moved?.y ?? 0) - (top ?? 0))).toBeLessThan(6);
      }
      expect(count()).toBe(4);
    });
  },
  { timeout: 180000 },
);

requiredBrowserTest(
  'desktop: clicking the playing card again keeps it and closes Browse',
  async () => {
    await withPage(DESKTOP, false, async (page) => {
      await startDemo(page);
      await page.keyboard.press('b');
      await otherTiles(page).first().waitFor({
        state: 'visible',
        timeout: 30000,
      });
      const before = (await agentState(page)).presetId;
      await otherTiles(page).first().click();
      await waitForPresetOtherThan(page, before);
      const playing = (await agentState(page)).presetId;

      await browseDialog(page)
        .locator(`a[data-preset-id="${playing}"]`)
        .click();
      await browseDialog(page).waitFor({ state: 'detached', timeout: 10000 });
    });
  },
  { timeout: 180000 },
);

requiredBrowserTest(
  'phone: one pick folds Browse with no extra tap, and the stage stays in view',
  async () => {
    await withPage(PHONE, true, async (page) => {
      await startDemo(page);
      await page.locator('button[aria-label="Show controls"]').tap();
      const { step, count } = stepCounter();
      await step(() =>
        page
          .getByRole('button', { name: /browse presets/i })
          .first()
          .tap(),
      );
      await otherTiles(page).first().waitFor({
        state: 'visible',
        timeout: 30000,
      });

      const before = (await agentState(page)).presetId;
      const tile = otherTiles(page).first();
      const id = await tile.getAttribute('data-preset-id');
      const top = (await tile.boundingBox())?.y;
      await step(() => tile.tap());

      // The sheet has shrunk to show the stage, with the card left in place.
      // Wait for the fold to settle, not just for the panel to cross 150px:
      // sampling on that edge caught the card mid-animation on a busy runner
      // and read a 776px move that was not there a frame later.
      const shrunk = await page.evaluate(async (cardId) => {
        const frame = () => new Promise(requestAnimationFrame);
        const read = () => {
          const panel = document.querySelector('[role="dialog"]');
          const card = panel?.querySelector(`a[data-preset-id="${cardId}"]`);
          if (!panel || !card) return null;
          const panelTop = panel.getBoundingClientRect().top;
          return panelTop > 150
            ? { panelTop, cardTop: card.getBoundingClientRect().y }
            : null;
        };
        let previous = read();
        for (let attempt = 0; attempt < 180; attempt++) {
          await frame();
          const current = read();
          if (
            current !== null &&
            previous !== null &&
            Math.abs(current.cardTop - previous.cardTop) < 0.5
          ) {
            return current;
          }
          previous = current;
        }
        return null;
      }, id);
      if (!shrunk) {
        throw new Error('the Browse sheet never settled after the pick');
      }
      // A few pixels are a card's own hover and press styling.
      expect(Math.abs(shrunk.cardTop - (top ?? 0))).toBeLessThan(6);

      await waitForPresetOtherThan(page, before);
      await browseDialog(page).waitFor({ state: 'detached', timeout: 15000 });
      expect(count()).toBe(2);
    });
  },
  { timeout: 180000 },
);

/** A few silent samples, enough to count as an audio file. */
const SILENT_WAV_BASE64 =
  'UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQgAAAAAAAAAAAAAAA==';

requiredBrowserTest(
  'desktop: an audio file dropped on the landing starts it in one action',
  async () => {
    await withPage(DESKTOP, false, async (page) => {
      await startButton(page).waitFor({ state: 'visible', timeout: 60000 });
      await page.waitForFunction(
        () =>
          (
            window as unknown as {
              __stims_agent?: { getState: () => { engineReady?: boolean } };
            }
          ).__stims_agent?.getState().engineReady === true,
        undefined,
        { timeout: 60000 },
      );
      const { step, count } = stepCounter();
      await step(() =>
        page.evaluate((base64) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const transfer = new DataTransfer();
          transfer.items.add(
            new File([bytes], 'tone.wav', { type: 'audio/wav' }),
          );
          const heading = document.querySelector('h1') ?? document.body;
          for (const type of ['dragenter', 'dragover', 'drop']) {
            heading.dispatchEvent(
              new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer: transfer,
              }),
            );
          }
        }, SILENT_WAV_BASE64),
      );
      await page.waitForFunction(
        () =>
          (
            window as unknown as {
              __stims_agent: {
                getState: () => { audioSource?: string | null };
              };
            }
          ).__stims_agent.getState().audioSource === 'file',
        undefined,
        { timeout: 60000 },
      );
      expect(count()).toBe(1);
    });
  },
  { timeout: 180000 },
);

requiredBrowserTest(
  'desktop: a YouTube link pasted on the landing reaches its field in one action',
  async () => {
    await withPage(DESKTOP, false, async (page) => {
      await startButton(page).waitFor({ state: 'visible', timeout: 60000 });
      const { step, count } = stepCounter();
      const link = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      await step(() =>
        page.evaluate((text) => {
          const clipboardData = new DataTransfer();
          clipboardData.setData('text', text);
          document.body.dispatchEvent(
            new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData,
            }),
          );
        }, link),
      );
      const field = page.locator('[data-youtube-url-input="true"]').first();
      await field.waitFor({ state: 'visible', timeout: 10000 });
      expect(await field.inputValue()).toBe(link);
      expect(count()).toBe(1);
    });
  },
  { timeout: 120000 },
);
