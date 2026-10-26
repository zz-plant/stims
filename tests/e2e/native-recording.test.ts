/** Real MediaRecorder output has the native portrait/square dimensions selected in Record. */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium } from 'playwright';
import { runAgentAction, waitForAgentState } from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5238;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
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

for (const format of [
  { name: /Square post/, width: 1080, height: 1080 },
  { name: /Spotify Canvas/, width: 1080, height: 1920 },
]) {
  requiredBrowserTest(
    `recorded file decodes at ${format.width}×${format.height}`,
    async () => {
      const browser = await chromium.launch({
        headless: HEADLESS,
        args: WEBGL_RENDERER_ARGS,
      });
      try {
        const page = await browser.newPage({ acceptDownloads: true });
        await page.goto(
          `${SERVER_URL}/?agent=true&renderer=webgl&preset=shifter-curlique`,
          { waitUntil: 'domcontentloaded' },
        );
        await waitForAgentState(
          page,
          (state) =>
            state.presetId === 'shifter-curlique' &&
            state.engineState !== 'booting',
          45000,
        );
        await runAgentAction(page, 'audio-demo');
        await waitForAgentState(page, (state) => state.engineState === 'live');
        await runAgentAction(page, 'open-record');
        await page.getByRole('radio', { name: format.name }).check();
        expect(
          await page
            .getByText('Reduce flashing is on', { exact: false })
            .count(),
        ).toBeGreaterThan(0);
        await page
          .getByRole('button', { name: 'Start recording', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Stop and save video', exact: true })
          .waitFor();
        // Count rendered frames, never assume a wall-clock delay produced video.
        await page.evaluate(async () => {
          const load = new Function('path', 'return import(path)') as (
            path: string,
          ) => Promise<{
            subscribeToFrameDrawn: (cb: () => void) => () => void;
          }>;
          const frames = await load('/src/js/core/frame-drawn.ts');
          await new Promise<void>((resolve, reject) => {
            let count = 0;
            const stop = frames.subscribeToFrameDrawn(() => {
              if (++count < 20) return;
              clearTimeout(timer);
              stop();
              resolve();
            });
            const timer = setTimeout(() => {
              stop();
              reject(new Error('Recording received no frames'));
            }, 30000);
          });
        });
        const downloadEvent = page.waitForEvent('download');
        await page
          .getByRole('button', { name: 'Stop and save video', exact: true })
          .click();
        const download = await downloadEvent;
        const filePath = await download.path();
        if (!filePath) throw new Error('Recording was not downloaded');
        const bytes = await Bun.file(filePath).arrayBuffer();
        expect(bytes.byteLength).toBeGreaterThan(1000);
        const metadata = await page.evaluate(async (base64) => {
          const video = document.createElement('video');
          video.muted = true;
          video.src = `data:video/webm;base64,${base64}`;
          await new Promise<void>((resolve, reject) => {
            video.onloadeddata = () => resolve();
            video.onerror = () =>
              reject(new Error('Downloaded video did not decode'));
          });
          const result = {
            width: video.videoWidth,
            height: video.videoHeight,
            ready: video.readyState,
          };
          video.removeAttribute('src');
          video.load();
          return result;
        }, Buffer.from(bytes).toString('base64'));
        expect(metadata.width).toBe(format.width);
        expect(metadata.height).toBe(format.height);
        expect(metadata.ready).toBeGreaterThanOrEqual(2);
      } finally {
        await closeQuietly(browser);
      }
    },
    { timeout: 90000 },
  );
}
