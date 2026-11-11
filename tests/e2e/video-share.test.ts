/** The real browser captures frames; local edge handlers publish and restore them. */
import { afterAll, beforeAll, expect } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { onRequest as middleware } from '../../functions/_middleware.ts';
import { onRequest as flipbooks } from '../../functions/api/flipbooks/[[path]].ts';
import { buildPresetCodeHash } from '../../src/js/frontend/url-state.ts';
import { runAgentAction, waitForAgentState } from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5291;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
let server: DevServerHandle | null = null;
beforeAll(
  async () => {
    if (hasChromium) server = await startDevServer({ port: TEST_PORT });
  },
  { timeout: 60_000 },
);
afterAll(async () => {
  await server?.stop();
}, 30_000);

requiredBrowserTest(
  'a video link captures without audio upload and restores its published source',
  async () => {
    const browser = await chromium.launch({
      headless: true,
      args: WEBGL_RENDERER_ARGS,
    });
    const objects = new Map<string, Uint8Array>();
    const env = {
      VIDEO_PREVIEWS_ENABLED: 'true',
      VIDEO_UPLOAD_LIMITER: { limit: async () => ({ success: true }) },
      MEDIA: {
        input: () => ({
          transform: () => ({
            output: () => ({
              response: async () =>
                new Response(
                  new Uint8Array([
                    0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0,
                    0, 0, 105, 115, 111, 109,
                  ]),
                  { headers: { 'Content-Type': 'video/mp4' } },
                ),
            }),
          }),
        }),
      },
      STATIC_R2: {
        async get(key: string) {
          const value = objects.get(key);
          return value
            ? {
                size: value.length,
                arrayBuffer: async () => Uint8Array.from(value).buffer,
                json: async () => JSON.parse(new TextDecoder().decode(value)),
              }
            : null;
        },
        async put(key: string, value: string | Uint8Array) {
          objects.set(
            key,
            typeof value === 'string' ? new TextEncoder().encode(value) : value,
          );
        },
        async delete(keys: string[]) {
          for (const key of keys) objects.delete(key);
        },
      },
      ASSETS: { fetch: (request: Request) => fetch(request) },
    };
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        serviceWorkers: 'block',
      });
      const captured: {
        value: {
          source: string;
          clip: { frames: string[] };
          [key: string]: unknown;
        } | null;
      } = { value: null };
      await context.route('**/api/flipbooks/**', async (route) => {
        const incoming = route.request();
        const body = incoming.postData();
        if (incoming.method() === 'POST')
          captured.value = JSON.parse(body ?? '{}');
        const response = await flipbooks({
          env,
          request: new Request(incoming.url(), {
            method: incoming.method(),
            headers: await incoming.allHeaders(),
            ...(body ? { body } : {}),
          }),
        });
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
      });
      await context.route('**/s/*', async (route) => {
        const response = await middleware({
          request: new Request(route.request().url()),
          env,
          next: async () => new Response(null, { status: 404 }),
        });
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
      });
      const page = await context.newPage();
      const source = await Bun.file(
        'public/milkdrop-presets/libraries/projectm-cream-of-the-crop/shifter-curlique.milk',
      ).text();
      // The upload refuses any clip that flashes, and curlique's beat-flipped
      // swirl and time-cycled border flash in some four-second windows. This
      // last per-frame line runs after the preset's own and holds the picture
      // still: no swirl (q4 feeds per-pixel dx/dy), no audio-driven zoom, one
      // border colour. q32 is the marker the recipient must restore.
      const draft = `${source}\nper_frame_99999=q32=0.314159; q4=0; zoom=1; ob_r=0.5; ob_g=0.5; ob_b=0.5;\n`;
      await page.goto(
        `${SERVER_URL}/?preset=shifter-curlique&agent=true&renderer=webgl&lockQualityStep=6${buildPresetCodeHash(draft)}`,
        { waitUntil: 'domcontentloaded' },
      );
      await waitForAgentState(
        page,
        (state) =>
          state.presetId === 'shifter-curlique' &&
          state.engineState !== 'booting',
        60_000,
      );
      await runAgentAction(page, 'audio-demo');
      await waitForAgentState(
        page,
        (state) => state.engineState === 'live',
        60_000,
      );
      await page.evaluate(() =>
        window.__stims_agent?.waitForVariables(
          (v) => Math.abs(v.q32 - 0.314159) < 0.00001,
          60_000,
        ),
      );
      console.info('video-share: sender draft is running');
      await page.keyboard.press('Escape');
      await page
        .getByRole('button', { name: 'Share', exact: true })
        .click({ timeout: 30_000 });
      await page
        .getByRole('menuitem', {
          name: 'Publish a public video link…',
          exact: true,
        })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Create a video link' });
      const create = dialog.getByRole('button', {
        name: 'Create public link',
        exact: true,
      });
      await create.waitFor();
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>('[role="dialog"] .primary')
            ?.disabled,
      );
      expect(objects.size).toBe(0);
      mkdirSync('output/video-share', { recursive: true });
      for (const width of [375, 768, 1024, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        const box = await dialog.boundingBox();
        expect(box).not.toBeNull();
        expect((box?.x ?? -1) >= 0).toBe(true);
        expect((box?.width ?? width + 1) <= width).toBe(true);
        await page.screenshot({
          path: `output/video-share/dialog-${width}.png`,
        });
      }
      await create.click();
      // While the capture runs the button reads "Creating…"; it reads "Create
      // public link" again only when the capture or upload was refused.
      await dialog
        .getByRole('button', { name: 'Creating…', exact: true })
        .waitFor();
      const link = dialog.locator('a[href*="/s/"]');
      await link.or(create).waitFor({ timeout: 30_000 });
      if (!(await link.isVisible()))
        throw new Error(
          `The dialog refused the capture: ${await dialog.getByRole('status').textContent()}`,
        );
      console.info('video-share: preview published');
      const sharedUrl = await link.getAttribute('href');
      expect(sharedUrl).toBeString();
      if (!captured.value)
        throw new Error('The browser did not upload its capture.');
      const sent = captured.value;
      expect(sent.source).toContain('q32=0.314159');
      expect(sent.clip.frames).toHaveLength(20);
      expect(Object.keys(sent).sort()).toEqual([
        'clip',
        'presetId',
        'source',
        'title',
      ]);
      // The recipient must not inherit the sender's saved editor draft.
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      const receiver = await context.newPage();
      await receiver.goto(
        `${sharedUrl}?agent=true&renderer=webgl&lockQualityStep=6`,
        {
          waitUntil: 'domcontentloaded',
        },
      );
      await waitForAgentState(
        receiver,
        (state) =>
          state.panel === 'editor' && state.presetId === 'shifter-curlique',
        60_000,
      );
      await runAgentAction(receiver, 'audio-demo');
      await waitForAgentState(
        receiver,
        (state) => state.engineState === 'live',
        60_000,
      );
      const variables = await receiver.evaluate(() =>
        window.__stims_agent?.waitForVariables(
          (v) => Math.abs(v.q32 - 0.314159) < 0.00001,
          60_000,
        ),
      );
      expect(variables?.q32).toBeCloseTo(0.314159, 5);
      expect(
        await receiver
          .locator('meta[property="og:video:type"]')
          .getAttribute('content'),
      ).toBe('video/mp4');
      const deleteLink = dialog.getByRole('button', {
        name: 'Delete public link',
        exact: true,
      });
      await deleteLink.click();
      // The second press must land inside the confirm window (4 s). A
      // .click() first waits for the button to hold still across animation
      // frames, and with two software-rendered visualizers on a loaded
      // machine that wait took 1.7-2.5 s, so one run missed the window.
      // The armed button sits in a modal dialog with nothing over it, so
      // the press goes straight to it (about 0.2 s after the first).
      await dialog
        .getByRole('button', { name: 'Delete it for everyone', exact: true })
        .dispatchEvent('click');
      const deleted = dialog.getByRole('status').filter({ hasText: 'deleted' });
      await deleted.or(deleteLink).waitFor();
      if (!(await deleted.isVisible()))
        throw new Error(
          `The link was not deleted: ${await dialog.getByRole('status').textContent()}`,
        );
      expect(objects.size).toBe(0);
    } finally {
      await browser.close();
      await server?.stop();
      server = null;
    }
  },
  { timeout: 180_000 },
);
