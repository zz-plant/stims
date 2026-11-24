/** A click on the stage names the per-pixel controls; a slider moves one, and Edit code lands on its line. */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium } from 'playwright';
import { waitForAgentState } from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5249;
const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;
// Its per-pixel zoom builds on the base (`zoom=zoom+…`), so a slider can
// reach it; the base is 0.9497.
const PRESET = 'cotc-bmelgren-shimmer-n-shine';
let server: DevServerHandle | null = null;
beforeAll(
  async () => {
    if (hasChromium) server = await startDevServer({ port: TEST_PORT });
  },
  { timeout: 60000 },
);
afterAll(async () => {
  await server?.stop();
});

requiredBrowserTest(
  'inspect a spot, scale its zoom, and open the code at the zoom line',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: WEBGL_RENDERER_ARGS,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
      });
      await page.goto(`${ORIGIN}/?agent=true&renderer=webgl&preset=${PRESET}`, {
        waitUntil: 'domcontentloaded',
      });
      await page
        .getByRole('button', { name: 'Start visualizer' })
        .click({ timeout: 45000 });
      await waitForAgentState(
        page,
        (state) => state.engineState === 'live' && state.presetId === PRESET,
      );
      await page.evaluate(() =>
        window.__stims_agent?.run('toggle-canvas-inspector'),
      );
      const canvas = page
        .locator('.stims-canvas-inspector')
        .locator('..')
        .locator('canvas')
        .first();
      const box = await canvas.boundingBox();
      if (!box) throw new Error('stage canvas has no box');
      await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
      const card = page.getByRole('dialog', { name: 'What drives this spot' });
      await card.waitFor({ state: 'visible', timeout: 5000 });

      const readZoom = () =>
        page.evaluate(async () => {
          const variables = await window.__stims_agent?.getVariables();
          return variables?.zoom ?? null;
        });
      // getVariables is async, and waitForFunction does not await an async
      // predicate (the promise itself reads as true), so poll from here.
      const waitForZoom = async (target: number) => {
        const deadline = Date.now() + 5000;
        let last: number | null = null;
        while (Date.now() < deadline) {
          last = await readZoom();
          if (last !== null && Math.abs(last - target) < 1e-3) return;
          await page.waitForTimeout(50);
        }
        throw new Error(`zoom stayed at ${last}, expected ${target}`);
      };
      expect(await readZoom()).toBeCloseTo(0.9497, 3);
      // 2x doubles the preset's distance from neutral: 1 - 2 * 0.0503.
      // (Not 0x: the VM reads a zoom of 0 back as 1, which is also the
      // neutral value, so a wrong formula would pass there.)
      await card.getByRole('slider', { name: 'Scale zoom' }).fill('2');
      await waitForZoom(0.8994);

      await card
        .getByRole('button', { name: 'Edit the code for zoom' })
        .click();
      // The editor is code-split; the line is selected once it mounts.
      await page.waitForFunction(
        () =>
          document
            .querySelector('.stims-editor .cm-activeLine')
            ?.textContent?.includes('per_pixel_1=zoom=zoom+') ?? false,
        null,
        { timeout: 30000 },
      );
    } finally {
      await closeQuietly(browser);
    }
  },
  { timeout: 120000 },
);
