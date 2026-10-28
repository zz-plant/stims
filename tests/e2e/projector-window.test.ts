/**
 * The projector window, in a real browser: a click opens a same-origin popup,
 * the stage's WebGL canvas arrives in it as live video, a held blackout
 * reaches it, and closing it from the dock closes the window.
 *
 * The unit suite pins the service against a fake window. What it cannot show
 * is the part a browser decides: that the popup opens from the dock's click,
 * that `captureStream()` on the stage canvas yields frames a `<video>` in
 * another document can play, and that those frames carry the picture rather
 * than black.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium } from 'playwright';
import { runAgentAction, waitForAgentState } from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { openDockMenu } from './dock.ts';
import { HEADLESS, SOFTWARE_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5204;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
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
});

requiredBrowserTest(
  'the dock opens a projector that plays the stage, and closes it',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: SOFTWARE_RENDERER_ARGS,
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      const page = await context.newPage();
      await page.goto(`${SERVER_URL}/?agent=true&renderer=webgl`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('body[data-engine-state="ready"]', {
        timeout: 30000,
      });
      await waitForAgentState(page, (s) => Boolean(s.presetId), 30000);
      expect((await runAgentAction(page, 'audio-demo')).ok).toBe(true);
      await waitForAgentState(page, (s) => s.engineState === 'live', 30000);

      await openDockMenu(page);
      const [projector] = await Promise.all([
        page.waitForEvent('popup', { timeout: 10000 }),
        page.locator('[data-action="toggle-projector"]').click(),
      ]);
      expect(await projector.title()).toBe('Stims projector');

      // Frames, not just an element: the video has a size and is advancing.
      await projector.waitForFunction(
        () => {
          const video = document.getElementById(
            'stims-projector-stage',
          ) as HTMLVideoElement | null;
          return Boolean(
            video && video.videoWidth > 0 && video.currentTime > 0,
          );
        },
        undefined,
        { timeout: 20000 },
      );
      // And the frames are the picture. A capture of a context the browser
      // cannot read back arrives as black, every pixel; the first-run preset
      // lights about 5% of a downsampled frame on demo audio, so the bar is
      // "not black", not a brightness target.
      const litFraction = await projector.evaluate(() => {
        const video = document.getElementById(
          'stims-projector-stage',
        ) as HTMLVideoElement;
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 36;
        const context = canvas.getContext('2d');
        if (!context) return 0;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const { data } = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        );
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] + data[i + 1] + data[i + 2] > 30) lit += 1;
        }
        return lit / (data.length / 4);
      });
      expect(litFraction).toBeGreaterThan(0.01);

      // Held D blacks out the stage with a CSS filter, which a canvas capture
      // does not carry. The room has to go dark too. The browser normalises
      // the service's brightness(0.000) to brightness(0), so the check reads
      // the number.
      const projectorBlack = (black: boolean) =>
        projector.waitForFunction(
          (wanted) => {
            const video = document.getElementById(
              'stims-projector-stage',
            ) as HTMLVideoElement;
            const match = /^brightness\(([\d.]+)\)$/.exec(video.style.filter);
            return (match !== null && Number(match[1]) === 0) === wanted;
          },
          black,
          { timeout: 5000 },
        );
      await page.bringToFront();
      await page.keyboard.down('d');
      await projectorBlack(true);
      await page.keyboard.up('d');
      await projectorBlack(false);

      await openDockMenu(page);
      // Listening first: the window can be gone before a listener attached
      // after the click would hear it.
      await Promise.all([
        projector.waitForEvent('close', { timeout: 10000 }),
        page.locator('[data-action="toggle-projector"]').click(),
      ]);
      const closed = await waitForAgentState(
        page,
        (s) => s.statusLog.at(-1)?.message === 'Projector closed.',
        5000,
      );
      expect(closed.statusLog.at(-1)?.message).toBe('Projector closed.');
    } finally {
      await closeQuietly(browser);
    }
  },
  120000,
);
