/**
 * Tap tempo, end to end: K pressed on the beat reaches the runtime's beat
 * clock, and the tempo the runtime publishes is the tapped one.
 *
 * The unit suites cover the fit and the beat grid. What only a real page
 * can show is the path between them: the shortcut layer dispatching the
 * palette action, the core store, the frame loop reading it, the engine
 * snapshot carrying the tempo, and the agent state reporting who owns it.
 * Nothing here asserts on timing: the taps are spaced by in-page timers, so
 * the BPM they produce depends on scheduling, and the test checks only that
 * the state and the announcement agree about it.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium } from 'playwright';
import {
  getAgentState,
  runAgentAction,
  waitForAgentState,
} from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, SOFTWARE_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5202;
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
  'K taps set the tempo the runtime publishes, and Shift+K hands it back',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: SOFTWARE_RENDERER_ARGS,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
      });
      await page.goto(`${SERVER_URL}/?agent=true&renderer=webgl`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('body[data-engine-state="ready"]', {
        timeout: 30000,
      });
      await waitForAgentState(page, (s) => Boolean(s.presetId), 30000);
      const audio = await runAgentAction(page, 'audio-demo');
      expect(audio.ok).toBe(true);
      await waitForAgentState(page, (s) => s.engineState === 'live', 30000);
      expect((await getAgentState(page)).tempo.source).toBe('audio');

      // Four presses half a second apart, scheduled inside the page so the
      // gaps do not include a Playwright round trip each.
      await page.evaluate(async () => {
        for (let tap = 0; tap < 4; tap += 1) {
          document.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'k',
              code: 'KeyK',
              bubbles: true,
              cancelable: true,
            }),
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      });

      const tapped = await waitForAgentState(
        page,
        (s) => s.tempo.source === 'tap' && s.tempo.bpm !== null,
        10000,
      );
      const announced = tapped.statusLog
        .map((entry) => entry.message)
        .filter((message) => message.includes('BPM from your taps'))
        .at(-1);
      expect(announced).toBe(
        `${tapped.tempo.bpm} BPM from your taps. Auto-advance now switches on your downbeat.`,
      );

      await page.evaluate(() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'K',
            code: 'KeyK',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      const cleared = await waitForAgentState(
        page,
        (s) => s.tempo.source === 'audio',
        10000,
      );
      expect(cleared.statusLog.at(-1)?.message).toBe(
        'Tempo follows the music again.',
      );
    } finally {
      await closeQuietly(browser);
    }
  },
  90000,
);
