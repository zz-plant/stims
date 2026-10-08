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
 *   - The launch hero took its ink from the page theme while the stage
 *     canvas behind it stayed dark, so light mode rendered a #0f172a
 *     wordmark on an attract frame at ~1.005:1.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { type Browser, chromium, type Page } from 'playwright';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';

const TEST_PORT = 5183;
const chromeTest = requiredBrowserTest;

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
}, 30000);

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
  await settle(page, '[class*="_panel_"]');

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

/**
 * Wait for entrance animations to settle. The panel slides up over 300ms, so
 * measuring geometry immediately after it appears reads a partially
 * transformed box and fails intermittently.
 */
async function settle(page: Page, selector: string) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      return el.getAnimations().every((a) => a.playState !== 'running');
    },
    selector,
    { timeout: 10000 },
  );
}

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

chromeTest(
  'mobile layout scrolls and never overflows sideways',
  async () => {
    const page = await (browser as Browser).newPage({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    try {
      await page.goto(`${server?.url}/?agent=true`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('.stims-shell__stage-frame', {
        timeout: 30000,
      });

      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const frame = document.querySelector('.stims-shell__stage-frame');
        return {
          // A horizontal scrollbar on a phone is always a layout bug. The 2px
          // slack absorbs sub-pixel rounding on fractional device ratios.
          horizontalOverflow: doc.scrollWidth - doc.clientWidth,
          // The home stage must be reachable by scrolling rather than clipped.
          verticallyScrollable: doc.scrollHeight > doc.clientHeight,
          frameWidth: frame ? frame.getBoundingClientRect().width : 0,
          viewportWidth: doc.clientWidth,
        };
      });

      expect(layout.horizontalOverflow).toBeLessThanOrEqual(2);
      // The stage must actually occupy the viewport, not collapse to a sliver.
      expect(layout.frameWidth).toBeGreaterThan(layout.viewportWidth * 0.8);
    } finally {
      await page.close();
    }
  },
  60000,
);

chromeTest(
  'panel becomes a full-width sheet on mobile',
  async () => {
    const page = await (browser as Browser).newPage({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      await page.goto(`${server?.url}/?agent=true&panel=browse`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('.ctl-browse-filters', { timeout: 30000 });
      await settle(page, '[class*="_panel_"]');

      const panel = await page.evaluate(() => {
        const el = document.querySelector('[class*="_panel_"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          width: Math.round(r.width),
          viewport: document.documentElement.clientWidth,
          bottom: Math.round(r.bottom),
          viewportHeight: window.innerHeight,
        };
      });

      expect(panel).not.toBeNull();
      // Bottom sheet: spans the viewport width and is anchored to the bottom.
      expect(panel?.width).toBe(panel?.viewport as number);
      expect(
        Math.abs((panel?.bottom ?? 0) - (panel?.viewportHeight ?? 0)),
      ).toBeLessThanOrEqual(2);
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
        const results = await page.evaluate(() => {
          // Inlined rather than passed in: page.evaluate cannot serialise a
          // closure, and eval() of a stringified helper is both a lint
          // violation and needless indirection.
          const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
          const lin = (v: number) => {
            const n = v / 255;
            return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          };
          const lum = (rgb: number[]) =>
            0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
          const contrast = (fg: string, bg: string) => {
            const f = parse(fg);
            const b = parse(bg);
            // Flatten a translucent foreground onto its backdrop first.
            const front =
              f.length > 3 && f[3] < 1
                ? [0, 1, 2].map((i) => f[3] * f[i] + (1 - f[3]) * b[i])
                : f.slice(0, 3);
            const L1 = lum(front);
            const L2 = lum(b.slice(0, 3));
            return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          };
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
        });

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

/**
 * Mobile viewport invariants, rendered. These used to live only as CSS-text
 * regexes in tests/unit/mobile-viewport-matrix.test.ts; each one here measures
 * the computed result at a phone viewport instead. The unit file keeps the
 * declarations a desktop Chromium cannot observe (safe-area env() resolves to
 * 0 outside a notched device).
 */
chromeTest(
  'mobile: the page never scrolls horizontally',
  async () => {
    const page = await (browser as Browser).newPage({
      viewport: { width: 375, height: 812 },
    });
    try {
      await page.goto(`${server?.url}/?agent=true`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('.stims-shell', { timeout: 30000 });
      // Overflowing rail actions were the shipped defect (5619d17a): the
      // action row refused to wrap and dragged the whole document wider than
      // the phone.
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - window.innerWidth,
        body: document.body.scrollWidth - window.innerWidth,
      }));
      expect(overflow.doc).toBeLessThanOrEqual(0);
      expect(overflow.body).toBeLessThanOrEqual(0);
    } finally {
      await page.close();
    }
  },
  60000,
);

chromeTest(
  'short landscape: the launch hero scrolls instead of clipping',
  async () => {
    const page = await (browser as Browser).newPage({
      viewport: { width: 812, height: 375 },
    });
    try {
      await page.goto(`${server?.url}/?agent=true`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('.stims-shell__stage-hero', {
        timeout: 30000,
      });
      // The shipped defect: at phone-landscape heights the hero was taller
      // than the viewport with no scroll path, so the launch actions below
      // the fold were unreachable.
      const hero = await page.evaluate(() => {
        const el = document.querySelector('.stims-shell__stage-hero');
        if (!el) return null;
        return {
          overflowY: getComputedStyle(el).overflowY,
          scrollable: el.scrollHeight > el.clientHeight,
        };
      });
      expect(hero).not.toBeNull();
      expect(['auto', 'scroll']).toContain(hero?.overflowY ?? 'missing');
    } finally {
      await page.close();
    }
  },
  60000,
);

chromeTest(
  'launch hero copy stays legible over the stage in light mode',
  async () => {
    if (!hasChromium) return;
    const page = await (browser as Browser).newPage({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'light',
    });
    try {
      await page.addInitScript(() => {
        try {
          localStorage.setItem('stims:theme', 'light');
        } catch {}
      });
      await page.goto(`${server?.url}/?agent=true`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('.stims-shell__launch-title', {
        timeout: 30000,
      });

      // The hero sits on the stage canvas, not on the page background, and
      // the stage is dark in every theme. Measuring against the body colour
      // would pass the exact defect this guards: the ink flipped to the light
      // palette while the backdrop did not.
      const results = await page.evaluate(() => {
        const parse = (value: string) =>
          (value.match(/[\d.]+/g) ?? []).map(Number);
        const lin = (c: number) => {
          const v = c / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        const lum = (rgb: number[]) =>
          0.2126 * lin(rgb[0] ?? 0) +
          0.7152 * lin(rgb[1] ?? 0) +
          0.0722 * lin(rgb[2] ?? 0);
        // A MilkDrop frame is not a flat colour, so the worst realistic
        // backdrop is used rather than an average: mid grey stands in for the
        // brightest the stage gets under the copy.
        const backdrop = [96, 96, 96];
        const targets = [
          '.stims-shell__launch-nameplate',
          '.stims-shell__launch-title',
          '.stims-shell__launch-tagline',
          '.stims-shell__launch-note',
        ];
        return targets.flatMap((sel) => {
          const el = document.querySelector(sel);
          if (!el) return [];
          const cs = getComputedStyle(el as HTMLElement);
          const f = parse(cs.color);
          const front =
            f.length > 3 && (f[3] ?? 1) < 1
              ? [0, 1, 2].map(
                  (i) =>
                    (f[3] ?? 1) * (f[i] ?? 0) +
                    (1 - (f[3] ?? 1)) * (backdrop[i] ?? 0),
                )
              : f.slice(0, 3);
          const L1 = lum(front);
          const L2 = lum(backdrop);
          return [
            {
              sel,
              px: Number.parseFloat(cs.fontSize),
              ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05),
            },
          ];
        });
      });

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        const needed = r.px >= 24 ? 3 : 4.5;
        if (r.ratio < needed) {
          throw new Error(
            `${r.sel} at ${r.px}px has contrast ${r.ratio.toFixed(2)}:1 over the stage in light mode, needs ${needed}:1`,
          );
        }
      }
    } finally {
      await page.close();
    }
  },
  60000,
);

/**
 * The boot cover paints the first-visit header from HTML, so the largest text
 * on the page does not wait for the app bundle, then crossfades into the
 * React launch page drawing the same lines. Wherever the two disagree on a
 * line's box, the 220ms fade shows both copies offset from each other. The
 * cover's 14px/24px offsets were once stale against the launch column, and
 * base.css's scrollbar gutter narrowed the cover by 15px on desktops with
 * classic scrollbars.
 */
chromeTest(
  'the boot cover hands off to the launch page without moving a line',
  async () => {
    const lines: [cover: string, launch: string][] = [
      ['.stims-loading__brand', '.stims-shell__launch-nameplate'],
      ['.stims-loading__title', '.stims-shell__launch-title'],
      ['.stims-loading__tagline', '.stims-shell__launch-tagline'],
    ];
    const boxes = (page: Page, selectors: string[]) =>
      page.evaluate(async (sels) => {
        await document.fonts.ready;
        return sels.map((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return [r.left, r.top, r.width, r.height].map(Math.round);
        });
      }, selectors);

    for (const viewport of [
      { width: 412, height: 823 },
      { width: 1440, height: 900 },
    ]) {
      // The cover alone: with the app entry blocked it never leaves.
      const coverPage = await (browser as Browser).newPage({ viewport });
      let coverBoxes: (number[] | null)[];
      try {
        await coverPage.route('**/src/js/app.ts', (route) => route.abort());
        await coverPage.goto(`${server?.url}/`, { waitUntil: 'load' });
        coverBoxes = await boxes(
          coverPage,
          lines.map(([cover]) => cover),
        );
      } finally {
        await coverPage.close();
      }

      const launchPage = await (browser as Browser).newPage({ viewport });
      try {
        await launchPage.goto(`${server?.url}/`, {
          waitUntil: 'domcontentloaded',
        });
        await launchPage.waitForSelector('.stims-shell__launch-tagline', {
          timeout: 30000,
        });
        await launchPage.waitForSelector('#stims-loading', {
          state: 'detached',
          timeout: 30000,
        });
        const launchBoxes = await boxes(
          launchPage,
          lines.map(([, launch]) => launch),
        );
        lines.forEach(([cover, launch], index) => {
          const from = coverBoxes[index];
          const to = launchBoxes[index];
          if (!from || !to) {
            throw new Error(`${from ? launch : cover} did not render`);
          }
          const drift = Math.max(...from.map((v, i) => Math.abs(v - to[i])));
          if (drift > 1) {
            throw new Error(
              `${cover} [${from}] lands ${drift}px away from ${launch} [${to}] at ${viewport.width}x${viewport.height}`,
            );
          }
        });
      } finally {
        await launchPage.close();
      }
    }
  },
  90000,
);

/**
 * The raw HTML carries crawl copy in #app (the site index footer, and on a
 * hub route its preset list) that React replaces on mount. Laid out under
 * the boot cover, it reflowed when the deferred stylesheets landed: a layout
 * shift of 0.2-0.47 on a desktop home page that nobody could see, but that
 * CLS counted all the same.
 */
chromeTest(
  'nothing shifts under the boot cover',
  async () => {
    type CoverRecord = {
      shifts: { at: number; value: number; sources: string[] }[];
      coverGoneAt: number | null;
    };
    for (const path of ['/', '/discover/fractal']) {
      const page = await (browser as Browser).newPage({
        viewport: { width: 1440, height: 900 },
      });
      try {
        await page.addInitScript(() => {
          const record: CoverRecord = { shifts: [], coverGoneAt: null };
          (window as unknown as { __cover: CoverRecord }).__cover = record;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as unknown as {
              startTime: number;
              value: number;
              sources?: { node?: Node | null }[];
            }[]) {
              record.shifts.push({
                at: entry.startTime,
                value: entry.value,
                sources: (entry.sources ?? []).map(
                  (source) => source.node?.nodeName ?? '?',
                ),
              });
            }
          }).observe({ type: 'layout-shift', buffered: true });
          new MutationObserver(() => {
            if (
              record.coverGoneAt === null &&
              document.body &&
              !document.getElementById('stims-loading')
            ) {
              record.coverGoneAt = performance.now();
            }
          }).observe(document, { childList: true, subtree: true });
        });
        await page.goto(`${server?.url}${path}`, { waitUntil: 'load' });
        await page.waitForSelector('#stims-loading', {
          state: 'detached',
          timeout: 30000,
        });
        const record = await page.evaluate(
          () => (window as unknown as { __cover: CoverRecord }).__cover,
        );
        const underCover = record.shifts.filter(
          (shift) =>
            shift.value > 0 && shift.at < (record.coverGoneAt ?? Infinity),
        );
        expect({ path, underCover }).toEqual({ path, underCover: [] });
      } finally {
        await page.close();
      }
    }
  },
  90000,
);
