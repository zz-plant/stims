/**
 * Rendered-invariant checks for the workspace chrome.
 *
 * Deliberately not pixel snapshots: baselines captured on macOS drift against
 * Linux CI on font rasterisation alone, and this repo already has enough tests
 * that fail for reasons unrelated to the defect they claim to guard.
 *
 * Instead this asserts properties of the *computed* result, which are stable
 * across platforms. Each check corresponds to a defect that actually shipped:
 *
 *   - `var(--display-font)` was undefined, so every page fell back to the UA
 *     serif. Nothing caught it.
 *   - A blanket `input { min-height: 44px }` stretched checkboxes to 18x44.
 *   - The collection chips overflowed their row and clipped at both edges.
 *   - The side panel was hard-coded dark, so light mode failed WCAG AA.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import { type Browser, chromium, type Page } from 'playwright';
import { type DevServerHandle, startDevServer } from './dev-server.ts';

const TEST_PORT = 5183;
const hasChromium = fs.existsSync(chromium.executablePath());
const chromeTest = hasChromium ? test : test.skip;

let server: DevServerHandle | null = null;
let browser: Browser | null = null;

beforeAll(async () => {
  if (!hasChromium) return;
  server = await startDevServer({ port: TEST_PORT });
  browser = await chromium.launch({ headless: true });
}, 90000);

afterAll(async () => {
  await browser?.close();
  const s = server;
  server = null;
  await s?.stop();
});

async function openPanel(panel: string, theme: 'dark' | 'light' = 'dark') {
  const page = await (browser as Browser).newPage({
    viewport: { width: 1280, height: 900 },
  });
  // Seed the stored preference before boot. Toggling the class afterwards is
  // not enough: the app applies its own theme on mount and overwrites it,
  // which silently turned the light-mode assertions into a second dark run.
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('stims:theme', t as string);
    } catch {}
  }, theme);
  await page.goto(`${server?.url}/?agent=true&panel=${panel}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('.ctl-section, .ctl-browse-filters', {
    timeout: 30000,
  });

  // Fail loudly if the theme did not take, rather than measuring the wrong one.
  const applied = await page.evaluate(() =>
    document.documentElement.classList.contains('light') ? 'light' : 'dark',
  );
  if (applied !== theme) {
    throw new Error(
      `Expected ${theme} theme but the document resolved to ${applied}; the contrast assertions would have measured the wrong palette.`,
    );
  }
  return page;
}

/** WCAG relative-luminance contrast between two rendered colours. */
const CONTRAST_FN = `(fg, bg) => {
  const parse = (c) => c.match(/[\\d.]+/g).map(Number);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055) ** 2.4; };
  const lum = ([r,g,b]) => 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
  const f = parse(fg), b = parse(bg);
  const a = f.length > 3 && f[3] < 1
    ? [0,1,2].map(i => f[3]*f[i] + (1-f[3])*b[i])
    : f.slice(0,3);
  const L1 = lum(a), L2 = lum(b.slice(0,3));
  return (Math.max(L1,L2) + 0.05) / (Math.min(L1,L2) + 0.05);
}`;

chromeTest(
  'body text does not fall back to the UA serif',
  async () => {
    const page = await openPanel('settings');
    try {
      const family = await page.evaluate(
        () => getComputedStyle(document.body).fontFamily,
      );
      // The exact stack may change; falling back to a UA serif never should.
      expect(family.toLowerCase()).not.toMatch(/^(times|serif|"times)/);
      expect(family).toMatch(/Grotesk|Inter|system-ui|sans-serif/i);
    } finally {
      await page.close();
    }
  },
  60000,
);

chromeTest(
  'switches render as switches, not stretched bars',
  async () => {
    const page = await openPanel('settings');
    try {
      const boxes = await page.$$eval('.ctl-switch', (els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        }),
      );
      expect(boxes.length).toBeGreaterThan(0);
      for (const box of boxes) {
        // A control forced to a 44px touch target while keeping its 18px width
        // is the exact failure this guards; a switch is wider than it is tall.
        expect(box.h).toBeLessThanOrEqual(32);
        expect(box.w).toBeGreaterThan(box.h);
      }
    } finally {
      await page.close();
    }
  },
  60000,
);

chromeTest(
  'browse filter chips stay reachable rather than clipping',
  async () => {
    const page = await openPanel('browse');
    try {
      const scroller = await page.evaluate(() => {
        const el = document.querySelector('.ctl-scroller');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          overflowX: cs.overflowX,
          masked:
            cs.maskImage !== 'none' ||
            (cs as unknown as { webkitMaskImage?: string }).webkitMaskImage !==
              'none',
          overflows: el.scrollWidth > el.clientWidth,
        };
      });
      expect(scroller).not.toBeNull();
      // Content wider than the rail is expected; being unable to reach it is not.
      if (scroller?.overflows) {
        expect(scroller.overflowX).toBe('auto');
        expect(scroller.masked).toBe(true);
      }
    } finally {
      await page.close();
    }
  },
  60000,
);

for (const theme of ['dark', 'light'] as const) {
  chromeTest(
    `panel text meets WCAG AA in ${theme} mode`,
    async () => {
      const page = await openPanel('browse', theme);
      try {
        const results = await page.evaluate(
          ([contrastSrc]) => {
            const contrast = eval(contrastSrc as string) as (
              fg: string,
              bg: string,
            ) => number;
            const panel = document.querySelector('[class*="_panel_"]');
            if (!panel) return [];
            const bg = getComputedStyle(panel).backgroundColor;
            const targets = [
              '.ctl-preset__title',
              '.ctl-preset__meta',
              '.ctl-readout',
              '.ctl-field',
            ];
            return targets.flatMap((sel) => {
              const el = document.querySelector(sel);
              if (!el) return [];
              const cs = getComputedStyle(el);
              return [
                {
                  sel,
                  px: parseFloat(cs.fontSize),
                  ratio: contrast(cs.color, bg),
                },
              ];
            });
          },
          [CONTRAST_FN],
        );

        expect(results.length).toBeGreaterThan(0);
        for (const r of results) {
          const needed = r.px >= 24 ? 3 : 4.5;
          if (r.ratio < needed) {
            throw new Error(
              `${r.sel} at ${r.px}px has contrast ${r.ratio.toFixed(2)}:1 in ${theme} mode, needs ${needed}:1`,
            );
          }
        }
      } finally {
        await page.close();
      }
    },
    60000,
  );
}
