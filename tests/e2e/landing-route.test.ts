/**
 * E2E: an arrival the visitor did not turn into a session keeps its URL.
 *
 * Until 2026-10-07 an idle effect in App.tsx played the featured preset on
 * every arrival that was not already live, through the same route commit a
 * Browse pick uses: `{ ...route, panel: null, presetId }`. Two things broke.
 * A bare `/` was rewritten to `/?preset=<first-run id>`, so a reload took the
 * deep-link path and skipped the landing page (the promise
 * engine-route-publish.ts makes). And a search arrival on `/discover/<slug>`
 * or `/author/<slug>`, whose route opens Browse on that collection, had the
 * panel closed under it and saw the generic landing with another author's
 * preset.
 *
 * The effect was skipped under `?agent=true`, so every agent-mode suite missed
 * it. These pages load the way a visitor does, without agent mode.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium, type Page } from 'playwright';
import { getAgentState, waitForAgentState } from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5194;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
let devServer: DevServerHandle | null = null;

type UrlWriteWindow = typeof window & { __urlWrites?: string[] };

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

/**
 * Loads `path` as a visitor would and returns every URL the app wrote into
 * history once the catalog has landed and the idle work it queued has run.
 */
async function arrive(page: Page, path: string) {
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as UrlWriteWindow).__urlWrites = writes;
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method].bind(history);
      history[method] = (data, unused, url) => {
        writes.push(String(url ?? ''));
        original(data, unused, url);
      };
    }
  });
  await page.goto(`${SERVER_URL}${path}`, { waitUntil: 'domcontentloaded' });
  await waitForAgentState(page, (state) => state.catalogSize > 0, 60000);
  // Idle callbacks run in the order they were queued, so two queued now run
  // after anything the app scheduled when the catalog landed.
  for (let round = 0; round < 2; round += 1) {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestIdleCallback(() => resolve(), { timeout: 5000 }),
        ),
    );
  }
  return page.evaluate(() => (window as UrlWriteWindow).__urlWrites ?? []);
}

requiredBrowserTest(
  'arrivals keep their own URL until the visitor starts a session',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: WEBGL_RENDERER_ARGS,
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });

      const home = await context.newPage();
      const homeWrites = await arrive(home, '/?renderer=webgl');
      expect(homeWrites.filter((url) => url.includes('preset='))).toEqual([]);
      expect(new URL(home.url()).searchParams.get('preset')).toBeNull();
      expect((await getAgentState(home)).panel).toBeNull();

      for (const hub of ['/discover/trippy', '/author/geiss']) {
        const page = await context.newPage();
        const writes = await arrive(page, `${hub}?renderer=webgl`);
        expect(writes.filter((url) => url.includes('preset='))).toEqual([]);
        const url = new URL(page.url());
        expect(url.pathname).toBe(hub);
        expect(url.searchParams.get('preset')).toBeNull();
        // The hub's route opens Browse on its collection; it must stay open.
        expect((await getAgentState(page)).panel).toBe('browse');
      }
    } finally {
      await closeQuietly(browser);
    }
  },
  { timeout: 180000 },
);
