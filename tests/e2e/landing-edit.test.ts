/**
 * E2E: the landing's Edit affordance — the "Open one up" moment's missing
 * front door (docs/PRODUCT_MOMENTS.md).
 *
 * The landing promises "Open one to see which sounds drive it, then change
 * its code while it runs", and for the funnel's first month no control on
 * that page opened the editor: the ways in were the E key and a dock button
 * that only exists after audio starts. This suite walks the new front door
 * the way a visitor meets it:
 *
 *   1. From the first-run state, with no deep link, wait for the attract
 *      preset behind the landing and press the landing's "Edit this one"
 *      button — by pointer, no keyboard knowledge needed.
 *   2. The editor opens on the running preset's code: the CodeMirror
 *      content arrives, and with it the "Try one edit" guide (which only
 *      renders once the editor has a source).
 *
 * WebGL and frame-free waits, like tests/e2e/open-one-up.test.ts, so CI's
 * SwiftShader runner can run it.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium, type Page } from 'playwright';
import { FIRST_RUN_PRESET_ID } from '../../src/js/milkdrop/runtime/first-run-preset.ts';
import {
  agentPredicates,
  getAgentState,
  waitForAgentState,
  writeAgentFailureArtifact,
} from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly, withDeadline } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5195;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

const LAUNCH_TIMEOUT_MS = 60_000;
/** The landing page and the editor are both lazy chunks on a cold vite. */
const CHUNK_TIMEOUT_MS = 90_000;
const CLICK_TIMEOUT_MS = 30_000;
/** The attract preset is compiled during idle budget, not on load. */
const ATTRACT_TIMEOUT_MS = 60_000;
const EDITOR_TIMEOUT_MS = 60_000;

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

/**
 * The landing's Edit button. `data-action="open-editor"` is the stable
 * automation hook the dock's own Edit carries; the visible label is copy.
 */
function landingEditButton(page: Page) {
  return page.locator(
    '.stims-shell__launch-actions-minimal [data-action="open-editor"]',
  );
}

requiredBrowserTest(
  'landing edit: the promise has a button that opens the running preset in the editor',
  async () => {
    const browser = await withDeadline(
      chromium.launch({ headless: HEADLESS, args: WEBGL_RENDERER_ARGS }),
      LAUNCH_TIMEOUT_MS,
      'launching Chromium',
    );
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (error) => {
      console.log(`[LANDING EDIT PAGE ERROR] ${error.message}`);
    });

    try {
      // No ?preset= and no ?audio=: the first-run landing is the subject.
      await page.goto(
        `${SERVER_URL}/?agent=true&renderer=webgl&lockQualityStep=6`,
        { waitUntil: 'domcontentloaded', timeout: CHUNK_TIMEOUT_MS },
      );

      // The attract preset has to be running for the button to mean
      // anything — it opens "this one", and gates on the same flag the
      // page's "Running now" caption does.
      await landingEditButton(page).waitFor({
        state: 'attached',
        timeout: CHUNK_TIMEOUT_MS,
      });
      await waitForAgentState(
        page,
        (state) =>
          agentPredicates.engineReady()(state) &&
          state.presetId === FIRST_RUN_PRESET_ID,
        ATTRACT_TIMEOUT_MS,
      );

      // By pointer: the point of the button is that no key needs knowing.
      await landingEditButton(page).click({ timeout: CLICK_TIMEOUT_MS });
      await waitForAgentState(
        page,
        (state) => state.panel === 'editor',
        EDITOR_TIMEOUT_MS,
      );

      // The editor arrives with the attract preset's code, not an empty
      // document: the code content and the first-edit guide (which renders
      // only once a source reached it) are both up.
      await page
        .locator('.stims-editor__code .cm-content')
        .waitFor({ timeout: EDITOR_TIMEOUT_MS });
      await page
        .locator('.stims-editor-intro')
        .waitFor({ timeout: EDITOR_TIMEOUT_MS });
      const code = await page.evaluate(
        () =>
          document.querySelector('.stims-editor__code .cm-content')
            ?.textContent ?? '',
      );
      expect(
        code.length,
        'the code pane holds the preset source',
      ).toBeGreaterThan(100);

      // The visit is still a landing visit: no audio was started, no
      // preset changed.
      const state = await getAgentState(page);
      expect(state.audioSource).toBeNull();
      expect(state.presetId).toBe(FIRST_RUN_PRESET_ID);
      expect(state.lastError).toBeNull();
    } catch (error) {
      await writeAgentFailureArtifact(page, 'landing-edit');
      throw error;
    } finally {
      await closeQuietly(ctx, browser);
    }
  },
  // Worst case, every bound reached in sequence: launch 60 + goto 90 +
  // button attach 90 + attract 60 + click 30 + panel 60 + code 60 + guide
  // 60 + state reads 15 + failure dump 30 + teardown 30 = 585s. Each step
  // fails at its own deadline with a message naming it; this backstop only
  // exists so the first real error wins.
  { timeout: 660_000 },
);
