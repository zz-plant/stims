/**
 * E2E: the first-run path on Firefox and WebKit.
 *
 * Every other e2e file runs Chromium only, so behaviour that differs by
 * browser was decided from browser docs and a user-agent check. The 2026-10-21
 * anxiety pass (#1531) is the case in point: Firefox and Safari open the
 * screen-share picker but never hand back an audio track, so the landing's
 * source chips hide "Tab / system" and "YouTube" there and say why
 * (src/js/frontend/AudioSourcePanel.tsx). This smoke runs Playwright's
 * `firefox` and `webkit` builds against the dev server and checks:
 *
 *   1. the landing renders, with its Play demo button and source chips;
 *   2. the chips leave out tab and YouTube capture and show the
 *      "need Chrome or Edge" note in their place;
 *   3. Play demo takes the engine live on WebGL with the demo track.
 *
 * Playwright's WebKit is close to Safari but is not Safari; a pass here is
 * evidence for the engine and the gating, not for every Safari quirk.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { type BrowserType, firefox, type Page, webkit } from 'playwright';
import { agentPredicates, waitForAgentState } from './agent-api.ts';
import { hasBrowser, requiredBrowserTestOn } from './browser-availability.ts';
import { closeQuietly, withDeadline } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';

const TEST_PORT = 5212;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

const BROWSERS: readonly BrowserType[] = [firefox, webkit];

const LAUNCH_TIMEOUT_MS = 60_000;
/** The home page is a lazy chunk a cold vite transforms. */
const HOME_CHUNK_TIMEOUT_MS = 90_000;
const CLICK_TIMEOUT_MS = 30_000;
const LIVE_TIMEOUT_MS = 90_000;

let devServer: DevServerHandle | null = null;

beforeAll(
  async () => {
    if (!BROWSERS.some(hasBrowser)) return;
    devServer = await startDevServer({ port: TEST_PORT });
  },
  { timeout: 60_000 },
);

afterAll(async () => {
  const server = devServer;
  devServer = null;
  await server?.stop();
}, 30_000);

/** The chip labels the landing's source row shows, in order. */
async function sourceChipLabels(page: Page): Promise<string[]> {
  return page
    .locator('.stims-shell__launch-sources-inline button strong')
    .allTextContents();
}

for (const browserType of BROWSERS) {
  const name = browserType.name();
  requiredBrowserTestOn(
    browserType,
    `${name}: the landing renders, hides tab and YouTube capture, and Play demo goes live on WebGL`,
    async () => {
      // Headless everywhere: neither browser needs a display for WebGL, and a
      // headed window would only add focus and occlusion to reason about.
      const browser = await withDeadline(
        browserType.launch({ headless: true }),
        LAUNCH_TIMEOUT_MS,
        `launching ${name}`,
      );
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
        console.log(`[${name.toUpperCase()} PAGE ERROR] ${error.message}`);
      });

      try {
        await page.goto(
          `${SERVER_URL}/?agent=true&renderer=webgl&lockQualityStep=6`,
          { waitUntil: 'domcontentloaded', timeout: HOME_CHUNK_TIMEOUT_MS },
        );

        // 1. The landing: its heading, its primary button and its chips.
        const playDemo = page.locator(
          '.stims-shell__launch-cta[data-demo-audio-btn]',
        );
        await playDemo.waitFor({
          state: 'visible',
          timeout: HOME_CHUNK_TIMEOUT_MS,
        });
        await expect(
          page.getByRole('heading', { level: 1 }).first().isVisible(),
        ).resolves.toBe(true);
        const sources = page.locator('.stims-shell__launch-sources-inline');
        await sources.waitFor({
          state: 'visible',
          timeout: HOME_CHUNK_TIMEOUT_MS,
        });

        // 2. Capture this browser cannot do is not offered, and the note
        // says what to use instead.
        const labels = await sourceChipLabels(page);
        expect(labels, 'the microphone chip proves the row rendered').toContain(
          'Microphone',
        );
        expect(labels).not.toContain('Tab / system');
        expect(labels).not.toContain('YouTube');
        await expect(
          sources.getByText('need Chrome or Edge').isVisible(),
        ).resolves.toBe(true);

        // 3. Play demo: live, on WebGL, with the demo track.
        await playDemo.click({ timeout: CLICK_TIMEOUT_MS });
        const live = await waitForAgentState(
          page,
          (state) =>
            agentPredicates.engineLive()(state) &&
            agentPredicates.backendIs('webgl')(state) &&
            state.audioSource === 'demo',
          LIVE_TIMEOUT_MS,
        );
        expect(live.presetId).not.toBeNull();
        expect(live.lastError).toBeNull();
        expect(pageErrors).toEqual([]);
      } finally {
        await closeQuietly(ctx, browser);
      }
    },
    { timeout: 240_000 },
  );
}
