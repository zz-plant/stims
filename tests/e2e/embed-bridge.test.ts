/**
 * The iframe postMessage protocol end to end, the way an embedding site uses
 * it: the app at `?embed=true` inside a parent page, commands posted from the
 * parent, replies matched by `requestId`.
 *
 * tests/unit/agent-bridge.test.ts checks each reply against a fake engine.
 * This checks that the real app, across a real frame boundary, keeps the
 * contract public/llms-full.txt documents. Every case here was found by hand
 * first: a command that replied success without acting, a request lost to
 * the boot preset, an embedded page whose stage never mounted.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium } from 'playwright';
import {
  AUTOPLAY_ARG,
  openEmbedded,
  sendToil,
} from '../../scripts/embed-harness.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, SOFTWARE_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5187;
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
  'an embedded page answers every command with what actually happened',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: [...SOFTWARE_RENDERER_ARGS, AUTOPLAY_ARG],
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 960, height: 540 },
      });
      const app = await openEmbedded(
        page,
        `${SERVER_URL}/?embed=true&agent=true&renderer=webgl`,
      );
      await app.waitForFunction(() => Boolean(window.__STIMS_AGENT_BRIDGE__), {
        timeout: 30000,
      });
      const send = (message: Record<string, unknown>) =>
        sendToil(page, message, { embedded: true, timeoutMs: 30000 });

      // Nothing mounts on an embedded page until something asks for it.
      expect(
        await send({ type: 'toil:midi_set', target: 'warp', value: 1.2 }),
      ).toMatchObject({ action: 'midi_set', success: false });

      // Asking for a preset is what boots the stage, and the reply waits for
      // the preset to show. Ids resolve the way the route resolves them.
      expect(
        await send({
          type: 'toil:load_preset',
          presetId: 'GEISS-CASINO',
          requestId: 'load-1',
        }),
      ).toMatchObject({
        type: 'toil:status',
        action: 'load_preset',
        success: true,
        presetId: 'geiss-casino',
        requestId: 'load-1',
      });

      const typo = await send({
        type: 'toil:load_preset',
        presetId: 'geiss-casin',
      });
      expect(typo.success).toBe(false);
      expect(typo.suggestions).toContain('geiss-casino');

      // Before audio starts, so no preset switch can replace the edit while
      // it compiles (that is reported too, as a different failure).
      const broken = await send({
        type: 'toil:apply_source',
        source: '[preset00]\nper_frame_1=zoom = (1 +;\n',
      });
      expect(broken).toMatchObject({ action: 'apply_source', success: false });
      expect(
        (broken.state as { errorCount: number } | null)?.errorCount,
      ).toBeGreaterThan(0);

      expect(
        await send({ type: 'toil:set_audio', source: 'demo' }),
      ).toMatchObject({ action: 'set_audio', success: true });
      expect(
        await send({ type: 'toil:set_audio', source: 'file' }),
      ).toMatchObject({ action: 'set_audio', success: false });

      expect(await send({ type: 'toil:run', id: 'next-preset' })).toMatchObject(
        { action: 'run', id: 'next-preset', success: true },
      );
      expect(
        await send({ type: 'toil:run', id: 'next-presett' }),
      ).toMatchObject({ action: 'run', success: false });

      expect(
        await send({ type: 'toil:midi_set', target: 'warp', value: 1.2 }),
      ).toMatchObject({ action: 'midi_set', success: true });
      expect(
        await send({ type: 'toil:midi_cc', cc: 21, value: 64 }),
      ).toMatchObject({ action: 'midi_cc', success: false });

      expect(
        await send({ type: 'toil:request_telemetry', requestId: 'tel-1' }),
      ).toMatchObject({ type: 'toil:telemetry', requestId: 'tel-1' });
      expect(await send({ type: 'toil:nope' })).toMatchObject({
        action: 'nope',
        success: false,
      });
    } finally {
      await closeQuietly(browser);
    }
  },
  { timeout: 180000 },
);

requiredBrowserTest(
  'an external embed parent gets visual controls and cannot dispatch device actions',
  async () => {
    // A real second loopback server gives Chromium both the origin and
    // address-space metadata needed for its private-network access policy.
    const parentServer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        new Response(
          `<iframe id="stims-embed" allow="autoplay" src="${SERVER_URL}/?embed=true&agent=true&renderer=webgl"></iframe>`,
          { headers: { 'Content-Type': 'text/html' } },
        ),
    });
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: [...SOFTWARE_RENDERER_ARGS, AUTOPLAY_ARG],
    });
    try {
      const page = await browser.newPage();
      const failures: string[] = [];
      page.on('pageerror', (error) => failures.push(error.message));
      page.on('requestfailed', (request) =>
        failures.push(`${request.url()}: ${request.failure()?.errorText}`),
      );
      page.on('console', (message) => {
        if (message.type() === 'error') failures.push(message.text());
      });
      await page.goto(parentServer.url.href);
      const app = page.frames().find((frame) => frame !== page.mainFrame());
      if (!app) throw new Error('The embed frame did not load.');
      await app
        .waitForFunction(() => Boolean(window.__STIMS_AGENT_BRIDGE__), null, {
          timeout: 30000,
        })
        .catch((error) => {
          throw new Error(`${error.message}\n${failures.join('\n')}`);
        });
      const send = (message: Record<string, unknown>) =>
        sendToil(page, message, { embedded: true, timeoutMs: 30000 });

      for (const id of ['toggle-camera', 'audio-tab', 'watch-party']) {
        expect(await send({ type: 'toil:run', id })).toMatchObject({
          action: 'run',
          id,
          success: false,
        });
      }
      expect(
        await send({ type: 'toil:load_preset', presetId: 'geiss-casino' }),
      ).toMatchObject({ action: 'load_preset', success: true });
      expect(await send({ type: 'toil:run', id: 'next-preset' })).toMatchObject(
        { action: 'run', id: 'next-preset', success: true },
      );
    } finally {
      await closeQuietly(browser);
      await parentServer.stop(true);
    }
  },
  { timeout: 180000 },
);
