/**
 * The embed code a visitor copies, pasted into a page the way they would
 * paste it: copied from the dock's Embed button off the real clipboard,
 * written into a host page as markup, and loaded. The unit tests check the
 * snippet's attributes; this checks that the frame those attributes describe
 * fills with the preset that was playing, at the size the page gives it.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium } from 'playwright';
import { runAgentAction, waitForAgentState } from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5297;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
const PRESET_ID = 'shifter-curlique';
// On the app's own origin: Chromium's local-network-access checks block a
// page on any other host from framing a loopback URL (scripts/embed-harness.ts).
const HOST_PAGE_URL = `${SERVER_URL}/__embed_snippet_host.html`;
const HOST_COLUMN_PX = 480;

let devServer: DevServerHandle | null = null;

beforeAll(
  async () => {
    if (!hasChromium) return;
    devServer = await startDevServer({ port: TEST_PORT });
  },
  { timeout: 60_000 },
);

afterAll(async () => {
  const server = devServer;
  devServer = null;
  await server?.stop();
}, 30_000);

requiredBrowserTest(
  'the copied embed code renders the playing preset in an iframe on another page',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: WEBGL_RENDERER_ARGS,
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        serviceWorkers: 'block',
      });
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: SERVER_URL,
      });

      const app = await context.newPage();
      await app.goto(
        `${SERVER_URL}/?preset=${PRESET_ID}&agent=true&renderer=webgl`,
        { waitUntil: 'domcontentloaded' },
      );
      await waitForAgentState(
        app,
        (state) =>
          state.presetId === PRESET_ID && state.engineState !== 'booting',
        60_000,
      );
      await runAgentAction(app, 'audio-demo');
      await waitForAgentState(
        app,
        (state) => state.engineState === 'live',
        60_000,
      );

      await app
        .getByRole('button', { name: 'More actions', exact: true })
        .click({ timeout: 30_000 });
      await app
        .getByRole('menuitem', { name: 'Copy embed code', exact: true })
        .click();
      await app
        .getByText('Embed code for “Curlique” copied', { exact: false })
        .waitFor({ timeout: 10_000 });
      const snippet = await app.evaluate(() => navigator.clipboard.readText());
      expect(snippet.startsWith('<iframe ')).toBe(true);
      await app.close();

      await context.route(HOST_PAGE_URL, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><meta charset="utf-8"><title>Embed host</title><main style="width:${HOST_COLUMN_PX}px;margin:24px">${snippet}</main>`,
        }),
      );
      const host = await context.newPage();
      await host.goto(HOST_PAGE_URL, { waitUntil: 'domcontentloaded' });
      const iframe = host.locator('main > iframe');
      expect(await iframe.count()).toBe(1);

      // A narrow column shrinks the frame and keeps it 16:9.
      const box = await iframe.boundingBox();
      expect(box?.width).toBe(HOST_COLUMN_PX);
      expect(box?.height).toBeCloseTo((HOST_COLUMN_PX * 9) / 16, 0);

      const frame = await (await iframe.elementHandle())?.contentFrame();
      if (!frame) throw new Error('The pasted iframe has no content frame.');
      expect(new URL(frame.url()).searchParams.get('embed')).toBe('true');
      await frame.waitForFunction(
        (id) => {
          const state = window.__stims_agent?.getState();
          return state?.presetId === id && state.engineState !== 'booting';
        },
        PRESET_ID,
        { timeout: 60_000 },
      );

      // Chromeless: no site footer, the brand link back instead.
      expect(await frame.locator('[data-embed-brand-link]').count()).toBe(1);

      // The browser holds the frame's demo track until the visitor clicks
      // inside it (docs/USER_GUIDE.md says so); click the picture, as they
      // would, and the sound reaches the preset.
      if (!box) throw new Error('The pasted iframe has no layout box.');
      await host.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
      await frame.waitForFunction(
        () => (window.__stims_agent?.getState().audioEnergy ?? 0) > 0,
        undefined,
        { timeout: 30_000 },
      );

      // The stage draws: a sample differs from the one before it, so the
      // frame holds neither a still nor a blank canvas.
      const deadline = Date.now() + 60_000;
      let motion = 0;
      while (motion === 0 && Date.now() < deadline) {
        motion = await frame.evaluate(async () => {
          const agent = window.__stims_agent;
          await agent?.captureStats();
          await new Promise((resolve) => setTimeout(resolve, 250));
          return (await agent?.captureStats())?.motionEstimate ?? 0;
        });
      }
      expect(motion).toBeGreaterThan(0);
    } finally {
      await closeQuietly(browser);
    }
  },
  { timeout: 240_000 },
);
