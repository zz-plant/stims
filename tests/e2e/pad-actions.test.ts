/**
 * A pad mapped to a command runs it, end to end.
 *
 * The unit suite covers the learn and the routing with the service and the
 * section in isolation. What only the real shell can show is the join between
 * them: App's palette list reaching Settings, the learn completing from a
 * real input source, and a later hit running the palette action through
 * App's dispatcher. A gamepad stands in for the MIDI controller, because it
 * enters the same note path as the `virtual:gamepad` device and Playwright
 * can supply one with a stubbed `navigator.getGamepads`.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium, type Page } from 'playwright';
import {
  getAgentState,
  runAgentAction,
  waitForAgentState,
} from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, SOFTWARE_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5203;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
/** Y on a standard pad. A, B, the shoulders and the d-pad move UI focus. */
const PAD_BUTTON = 3;
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

/** One connected standard pad whose buttons the test presses. */
function installFakeGamepad() {
  const buttons = Array.from({ length: 17 }, () => ({
    pressed: false,
    touched: false,
    value: 0,
  }));
  const pad = {
    id: 'Stims test pad',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons,
  };
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => [pad],
  });
  (window as unknown as { __testPad: typeof pad }).__testPad = pad;
}

async function setButton(page: Page, index: number, pressed: boolean) {
  await page.evaluate(
    ({ index, pressed }) => {
      const pad = (
        window as unknown as {
          __testPad: { buttons: Array<{ pressed: boolean; value: number }> };
        }
      ).__testPad;
      pad.buttons[index].pressed = pressed;
      pad.buttons[index].value = pressed ? 1 : 0;
    },
    { index, pressed },
  );
}

requiredBrowserTest(
  'a gamepad button learned to Next preset changes the preset',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: SOFTWARE_RENDERER_ARGS,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
      });
      await page.addInitScript(installFakeGamepad);
      await page.goto(`${SERVER_URL}/?agent=true&renderer=webgl`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('body[data-engine-state="ready"]', {
        timeout: 30000,
      });
      await waitForAgentState(
        page,
        (s) => Boolean(s.presetId) && s.catalogSize > 0,
        30000,
      );
      expect((await runAgentAction(page, 'audio-demo')).ok).toBe(true);
      await waitForAgentState(page, (s) => s.engineState === 'live', 30000);

      expect((await runAgentAction(page, 'open-settings')).ok).toBe(true);
      await page.click('#tab-hardware');
      const picker = page.locator('[aria-label="Command to map to a pad"]');
      await picker.selectOption('next-preset');
      await page
        .locator('.ctl-midi-learn-row', { has: picker })
        .getByRole('button', { name: 'Map the next pad I hit' })
        .click();

      // The poller starts when the browser is idle and installs the pad's
      // default stick mappings the first frame it sees one. A press before
      // that is never read, so wait for its own signal rather than a guess.
      await page
        .getByRole('button', { name: 'Remove mapping for CC0 (dx)' })
        .waitFor({ timeout: 30000 });

      // The hit that maps the button must not also change the preset.
      const before = (await getAgentState(page)).presetId;
      await setButton(page, PAD_BUTTON, true);
      await page
        .getByText('Mapped a pad to "Play a random preset". Hit it to run it.')
        .waitFor({ timeout: 20000 });
      await setButton(page, PAD_BUTTON, false);
      await page
        .getByRole('button', {
          name: `Remove mapping for pad ${PAD_BUTTON} (Play a random preset)`,
        })
        .waitFor({ timeout: 5000 });
      expect((await getAgentState(page)).presetId).toBe(before);

      await setButton(page, PAD_BUTTON, true);
      const after = await waitForAgentState(
        page,
        (s) => s.presetId !== null && s.presetId !== before,
        15000,
      );
      await setButton(page, PAD_BUTTON, false);
      expect(after.presetId).not.toBe(before);
    } finally {
      await closeQuietly(browser);
    }
  },
  120000,
);
