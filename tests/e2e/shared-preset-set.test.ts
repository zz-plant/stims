/** A set shared from an edited preset opens in a clean browser and retains its sequence. */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium } from 'playwright';
import { buildPresetSetShareUrl } from '../../src/js/frontend/preset-sets.ts';
import { waitForAgentState } from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5237;
const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;
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
  'a clean recipient can save and load an ordered set with missing entries',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: WEBGL_RENDERER_ARGS,
    });
    try {
      const page = await browser.newPage();
      const ids = [
        'geiss-casino',
        'not-a-bundled-preset',
        'shifter-curlique',
        'geiss-casino',
      ];
      const url = buildPresetSetShareUrl(
        `${ORIGIN}/?agent=true&renderer=webgl&preset=private-edit#code=private-source`,
        'Evening reprise',
        ids,
      );
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const dialog = page.getByRole('dialog', {
        name: 'Shared Preset Set: Evening reprise',
        exact: true,
      });
      await dialog.waitFor({ state: 'visible', timeout: 45000 });
      // Catalog loading is asynchronous. Await the agent snapshot before
      // interpreting unavailable entries or importing the sequence.
      await page
        .getByRole('button', { name: 'Load into queue', exact: true })
        .waitFor({ state: 'visible' });
      await waitForAgentState(page, (state) => state.catalogSize > 0);
      for (const width of [375, 768, 1024, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        const box = await dialog.boundingBox();
        expect(box).not.toBeNull();
        expect((box?.x ?? -1) >= 0).toBe(true);
        expect((box?.width ?? width + 1) <= width).toBe(true);
      }

      expect(await dialog.textContent()).toContain(
        '3 available in this catalog',
      );
      await dialog
        .getByRole('button', { name: 'Save to my sets', exact: true })
        .click();
      const saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('stims:preset-sets:v1') ?? '{}'),
      );
      expect(saved.sets[0]).toMatchObject({
        title: 'Evening reprise',
        presetIds: ['geiss-casino', 'shifter-curlique', 'geiss-casino'],
      });
      await dialog
        .getByRole('button', { name: 'Load into queue', exact: true })
        .click();
      await dialog.waitFor({ state: 'hidden' });
      expect(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('stims:preset-queue:v1') ?? '{}')
              .presetIds,
        ),
      ).toEqual(['geiss-casino', 'shifter-curlique', 'geiss-casino']);
      await page.reload({ waitUntil: 'domcontentloaded' });
      expect(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('stims:preset-sets:v1') ?? '{}')
              .sets[0].presetIds,
        ),
      ).toEqual(['geiss-casino', 'shifter-curlique', 'geiss-casino']);
    } finally {
      await closeQuietly(browser);
    }
  },
  { timeout: 90000 },
);
