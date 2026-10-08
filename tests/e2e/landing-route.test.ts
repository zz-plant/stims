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
 *
 * The same arrivals are the pages search engines index, and they index the
 * DOM after JavaScript runs, skipping <noscript>. Until 2026-10-08 every
 * `?preset=` page rendered the same h1 ("Stims visualizer", screen-reader
 * only) plus a hidden second one, and named its preset only in a status line;
 * the heading, byline and links the edge wrote lived in <noscript> alone. The
 * second test reads what a rendering crawler gets.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import {
  resolveSemanticRoute,
  semanticRouteHeading,
} from '../../functions/discover-slugs.ts';
import { buildHubCollectionContent } from '../../functions/shared/collection-page.ts';
import type { PresetMetaTable } from '../../functions/shared/preset-meta.ts';
import { buildPresetPageContent } from '../../functions/shared/preset-page.ts';
import { SITE_INDEX_SECTIONS } from '../../functions/shared/site-index.ts';
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

      // Each page is closed once read. A page left open keeps its attract
      // preview rendering, and on a two-core runner that starved the next
      // page's catalog load past arrive()'s deadline.
      const home = await context.newPage();
      const homeWrites = await arrive(home, '/?renderer=webgl');
      const homeUrl = home.url();
      const homePanel = (await getAgentState(home)).panel;
      await home.close();
      expect(homeWrites.filter((url) => url.includes('preset='))).toEqual([]);
      expect(new URL(homeUrl).searchParams.get('preset')).toBeNull();
      expect(homePanel).toBeNull();

      for (const hub of ['/discover/trippy', '/author/geiss']) {
        const page = await context.newPage();
        const writes = await arrive(page, `${hub}?renderer=webgl`);
        const url = new URL(page.url());
        const panel = (await getAgentState(page)).panel;
        await page.close();
        expect(writes.filter((url) => url.includes('preset='))).toEqual([]);
        expect(url.pathname).toBe(hub);
        expect(url.searchParams.get('preset')).toBeNull();
        // The hub's route opens Browse on its collection; it must stay open.
        expect(panel).toBe('browse');
      }
    } finally {
      await closeQuietly(browser);
    }
  },
  { timeout: 180000 },
);

type RenderedLink = { href: string | null; text: string; visible: boolean };
type RenderedPage = {
  headings: { text: string; visible: boolean }[];
  byline: string | null;
  links: RenderedLink[];
  belowStage: boolean;
  /** The hub list under the stage, when the page has one. */
  collection: { links: RenderedLink[]; belowStage: boolean } | null;
  /** The site index every page ends with. */
  footerLinks: RenderedLink[];
};

/**
 * The h1s on the page and, for the section holding the first, its byline and
 * links. "Visible" means a person can see it: rendered with a box, not
 * display:none / visibility:hidden / opacity 0 up the tree, not clipped to a
 * screen-reader-only pixel, and not inside <noscript>.
 */
function readRenderedPage(page: Page): Promise<RenderedPage> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      if (el.closest('noscript')) return false;
      if (
        !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      )
        return false;
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return false;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
          style.clipPath === 'inset(50%)' ||
          style.clip === 'rect(0px, 0px, 0px, 0px)'
        )
          return false;
      }
      return true;
    };
    const headings = [...document.querySelectorAll('h1')];
    const section = headings[0]?.closest('section') ?? null;
    const stage = document.getElementById('stims-visualizer');
    const readLinks = (root: Element | null) =>
      [...(root?.querySelectorAll('a') ?? [])].map((a) => ({
        href: a.getAttribute('href'),
        text: a.textContent ?? '',
        // Inert links read as text but cannot be followed.
        visible: visible(a) && !a.closest('[inert]'),
      }));
    const below = (el: Element | null) =>
      el !== null &&
      stage !== null &&
      el.getBoundingClientRect().top >=
        stage.getBoundingClientRect().bottom - 1;
    const collection = document.querySelector('[data-collection-page]');
    return {
      headings: headings.map((h) => ({
        text: h.textContent ?? '',
        visible: visible(h),
      })),
      byline: section?.querySelector('p')?.textContent ?? null,
      links: readLinks(section),
      belowStage: below(section),
      collection: collection
        ? { links: readLinks(collection), belowStage: below(collection) }
        : null,
      footerLinks: readLinks(document.querySelector('[data-site-index]')),
    };
  });
}

/** A preset whose credit chain names two hands, each with an author page. */
const CHAIN_PRESET = 'stahlregen-geiss-old-school-baby-flower-v2-1';

requiredBrowserTest(
  'arrival pages render one visible h1 naming them, and links a crawler can follow',
  async () => {
    const presetMeta = JSON.parse(
      readFileSync(
        join(import.meta.dir, '../../public/preset-meta.json'),
        'utf8',
      ),
    ) as PresetMetaTable;
    // What the edge writes into <noscript> for this page.
    const expected = buildPresetPageContent(presetMeta, CHAIN_PRESET);
    if (!expected) throw new Error(`${CHAIN_PRESET} is missing`);
    expect(expected.credits.map((credit) => credit.href)).toEqual([
      '/author/stahlregen',
      '/author/geiss',
    ]);
    const relatedHrefs = expected.related.flatMap((group) =>
      group.presets.map((preset) => preset.href),
    );
    expect(expected.related.map((group) => group.author)).toEqual([
      'Stahlregen',
      'Geiss',
    ]);

    const browser = await chromium.launch({
      headless: HEADLESS,
      args: WEBGL_RENDERER_ARGS,
    });
    try {
      // One page at a time, each closed once read: on a two-core runner a
      // page left rendering in the background starves the next page's
      // catalog load past its deadline.
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      const page = await context.newPage();
      await page.goto(`${SERVER_URL}/?preset=${CHAIN_PRESET}&renderer=webgl`, {
        waitUntil: 'domcontentloaded',
      });
      await waitForAgentState(
        page,
        (state) =>
          state.engineState === 'live' &&
          state.catalogSize > 0 &&
          state.presetId === CHAIN_PRESET,
        90000,
      );
      // The sibling lists settle once the whole catalog (libraries included)
      // has landed. A timeout falls through to the assertions, which say what
      // the page rendered instead.
      await page
        .waitForFunction(
          (count) =>
            document.querySelectorAll('section h1 ~ ul a[href^="/?preset="]')
              .length === count,
          relatedHrefs.length,
          { timeout: 30000 },
        )
        .catch(() => {});

      const rendered = await readRenderedPage(page);
      await context.close();
      expect(rendered.headings).toEqual([
        { text: expected.title, visible: true },
      ]);
      expect(rendered.byline).toBe(
        `A MilkDrop preset by ${expected.credits.map((credit) => credit.name).join(' + ')}.`,
      );
      // Under the stage, never over it.
      expect(rendered.belowStage).toBe(true);
      const presetLinks = rendered.links.filter((link) =>
        link.href?.startsWith('/?preset='),
      );
      expect(presetLinks.map((link) => link.href)).toEqual(relatedHrefs);
      for (const href of [
        '/author/stahlregen',
        '/author/geiss',
        ...relatedHrefs,
        expected.download,
      ]) {
        expect(rendered.links.find((link) => link.href === href)?.visible).toBe(
          true,
        );
      }
      expect(
        rendered.links.find((link) => link.href === expected.download)?.text,
      ).toBe('Download .milk');
      // The site index follows: /presets/ and every hub, visible.
      expect(
        rendered.footerLinks.filter((link) => link.visible).map((l) => l.href),
      ).toEqual(
        SITE_INDEX_SECTIONS.flatMap((section) =>
          section.links.map((link) => link.href),
        ),
      );

      // A fresh profile per hub: the preset page stored a resumable session.
      for (const hub of ['/author/geiss', '/discover/fractal']) {
        const route = resolveSemanticRoute(hub);
        if (!route) throw new Error(`${hub} is not a curated route`);
        const hubContext = await browser.newContext({
          viewport: { width: 1280, height: 720 },
        });
        const hubPage = await hubContext.newPage();
        await arrive(hubPage, `${hub}?renderer=webgl`);
        // What the edge writes into #app for this hub, from the same table.
        const expectedHrefs = buildHubCollectionContent(
          presetMeta,
          route,
        ).groups.flatMap((group) => group.presets.map((preset) => preset.href));
        // The list settles once the libraries have landed too.
        await hubPage
          .waitForFunction(
            (count) =>
              document.querySelectorAll(
                '[data-collection-page] a[href^="/?preset="]',
              ).length === count,
            expectedHrefs.length,
            { timeout: 30000 },
          )
          .catch(() => {});
        const hubRendered = await readRenderedPage(hubPage);
        // Browse is open on the collection; its presets are links.
        const browseLinks = await hubPage.evaluate(() =>
          [
            ...document.querySelectorAll<HTMLAnchorElement>(
              '.stims-preset-grid__item, .ctl-preset__open',
            ),
          ].map((link) => ({
            tag: link.tagName.toLowerCase(),
            href: link.getAttribute('href') ?? '',
          })),
        );
        await hubContext.close();
        expect(hubRendered.headings).toEqual([
          { text: semanticRouteHeading(route), visible: true },
        ]);
        // Every preset in the collection, as a visible link under the stage,
        // in the order the edge writes them.
        expect(hubRendered.collection?.belowStage).toBe(true);
        const collectionLinks = (hubRendered.collection?.links ?? []).filter(
          (link) => link.href?.startsWith('/?preset='),
        );
        expect(collectionLinks.map((link) => link.href)).toEqual(expectedHrefs);
        expect(collectionLinks.every((link) => link.visible)).toBe(true);
        expect(browseLinks.length).toBeGreaterThan(0);
        for (const link of browseLinks) {
          expect(link.tag).toBe('a');
          expect(link.href).toMatch(/^\/\?preset=[^&]+$/);
        }
      }
    } finally {
      await closeQuietly(browser);
    }
  },
  { timeout: 240000 },
);
