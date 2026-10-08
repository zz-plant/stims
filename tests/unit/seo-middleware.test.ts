import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  APP_ROOT_SELECTOR,
  NOSCRIPT_FALLBACK_SELECTOR,
  onRequest,
} from '../../functions/_middleware.ts';
import {
  AUTHOR_SLUGS,
  DISCOVER_ROUTES,
  DISCOVER_SLUGS,
  isAllowedAuthorSlug,
  isAllowedDiscoverSlug,
} from '../../functions/discover-slugs.ts';
import {
  __resetPresetMetaForTest,
  NOINDEX,
  type PresetMetaTable,
} from '../../functions/shared/preset-meta.ts';
import { SITE_INDEX_SECTIONS } from '../../functions/shared/site-index.ts';

// The edge middleware is the only thing standing between 1,787 preset URLs
// and a collapsed root canonical — and until now it had zero test coverage,
// so a silent no-op would have shipped unnoticed. Most tests here install a
// recording mock HTMLRewriter: selectors and handlers are captured, then
// invoked against fake elements to assert the values the middleware would
// write. The shipped-shell tests at the end run Bun's real HTMLRewriter over
// index.html, because which elements a selector matches is the behaviour.

type FakeElement = {
  attributes: Map<string, string>;
  innerContent: string | null;
  appended: string[];
  prepended: string[];
  setAttribute: (name: string, value: string) => void;
  setInnerContent: (value: string) => void;
  append: (value: string, options?: { html?: boolean }) => void;
  prepend: (value: string, options?: { html?: boolean }) => void;
};

function createFakeElement(): FakeElement {
  const el: FakeElement = {
    attributes: new Map(),
    innerContent: null,
    appended: [],
    prepended: [],
    setAttribute(name, value) {
      el.attributes.set(name, value);
    },
    setInnerContent(value) {
      el.innerContent = value;
    },
    append(value) {
      el.appended.push(value);
    },
    prepend(value) {
      el.prepended.push(value);
    },
  };
  return el;
}

type HandlerRecord = {
  selector: string;
  handler: { element?: (el: FakeElement) => void };
};

let recordedHandlers: HandlerRecord[] = [];
let transformCalls = 0;

class MockHTMLRewriter {
  on(selector: string, handler: HandlerRecord['handler']) {
    recordedHandlers.push({ selector, handler });
    return this;
  }

  transform(response: Response) {
    transformCalls += 1;
    return response;
  }
}

function applyHandlers(selector: string): FakeElement {
  const el = createFakeElement();
  for (const record of recordedHandlers) {
    if (record.selector === selector) {
      record.handler.element?.(el);
    }
  }
  return el;
}

function htmlResponse() {
  return new Response('<html><head></head><body></body></html>', {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-frame-options': 'SAMEORIGIN',
    },
  });
}

function makeContext(url: string, presetMeta?: Record<string, unknown>) {
  return {
    request: new Request(url),
    next: () => Promise.resolve(htmlResponse()),
    env: {
      ASSETS: {
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify(presetMeta ?? {}), {
              status: presetMeta ? 200 : 404,
              headers: { 'content-type': 'application/json' },
            }),
          ),
      },
    },
  };
}

/**
 * How the deployed Worker actually behaves: static assets have a file at `/`
 * and nothing at /discover/* or /author/*, and there is no SPA fallback, so
 * `next()` answers 404 with an empty body. Tests using `makeContext` above
 * mock `next()` as always returning the shell (the old Pages behaviour), which
 * is how a live outage of every curated hub page went unnoticed.
 */
function makeWorkerAssetsContext(url: string) {
  const assetsFetched: string[] = [];
  const context = {
    request: new Request(url),
    next: () => Promise.resolve(new Response(null, { status: 404 })),
    env: {
      ASSETS: {
        fetch: (request: Request) => {
          const path = new URL(request.url).pathname;
          assetsFetched.push(path);
          return Promise.resolve(
            path === '/' ? htmlResponse() : new Response(null, { status: 404 }),
          );
        },
      },
    },
  };
  return { context, assetsFetched };
}

const globalWithRewriter = globalThis as { HTMLRewriter?: unknown };
let originalRewriter: unknown;

beforeEach(() => {
  recordedHandlers = [];
  transformCalls = 0;
  originalRewriter = globalWithRewriter.HTMLRewriter;
  globalWithRewriter.HTMLRewriter = MockHTMLRewriter;
  // The preset-meta memo is per-isolate in production; bun shares one
  // process across test files, so each test needs a clean table.
  __resetPresetMetaForTest();
});

afterEach(() => {
  globalWithRewriter.HTMLRewriter = originalRewriter;
});

describe('discover slug allowlist', () => {
  test('accepts curated slugs and rejects arbitrary ones', () => {
    for (const slug of DISCOVER_SLUGS) {
      expect(isAllowedDiscoverSlug(slug)).toBe(true);
    }
    expect(isAllowedDiscoverSlug('totally-made-up-topic')).toBe(false);
    expect(isAllowedDiscoverSlug('')).toBe(false);
  });

  test('accepts only curated author slugs', () => {
    for (const slug of AUTHOR_SLUGS) {
      expect(isAllowedAuthorSlug(slug)).toBe(true);
    }
    expect(isAllowedAuthorSlug('made-up-author')).toBe(false);
  });
});

describe('/discover/<slug> middleware', () => {
  test('rewrites canonical, title, and description for an allowlisted slug', async () => {
    await onRequest(makeContext('https://toil.fyi/discover/fractal'));

    expect(transformCalls).toBe(1);

    const canonical = applyHandlers('link[rel="canonical"]');
    expect(canonical.attributes.get('href')).toBe(
      'https://toil.fyi/discover/fractal',
    );

    const title = applyHandlers('title');
    expect(title.innerContent).toContain('Fractal Music Visualizers');

    const description = applyHandlers('meta[name="description"]');
    expect(description.attributes.get('content')?.toLowerCase()).toContain(
      'fractal',
    );

    const head = applyHandlers('head');
    expect(head.appended.join('')).toContain('application/ld+json');
  });

  test('a retired slug redirects permanently to the page that replaced it', async () => {
    const response = await onRequest(
      makeContext('https://toil.fyi/discover/webgpu-showcase?audio=demo'),
    );

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(
      'https://toil.fyi/discover/hall-of-fame?audio=demo',
    );
    expect(transformCalls).toBe(0);
  });

  test('the empty retro hub redirects to the full index', async () => {
    const response = await onRequest(
      makeContext('https://toil.fyi/discover/retro'),
    );

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://toil.fyi/presets/');
  });

  test('writes every preset in the collection into #app, outside <noscript>', async () => {
    const fractalBit =
      1 << DISCOVER_ROUTES.findIndex((r) => r.slug === 'fractal');
    await onRequest(
      makeContext('https://toil.fyi/discover/fractal', {
        'mandel-b': ['Mandel B', 'Geiss', 0, fractalBit],
        'mandel-a': ['Mandel A', '', 0, fractalBit, NOINDEX],
        'tunnel-only': ['Tunnel Only', 'Geiss', 0, 0],
      } satisfies PresetMetaTable),
    );

    const app = applyHandlers(APP_ROOT_SELECTOR).prepended.join('');
    expect(app).toContain(
      '<h2 id="stims-collection-heading">All 2 presets</h2>',
    );
    // A–Z, with the credit on a topic page; a noindex preset is still part
    // of the collection Browse shows, so it is listed too.
    expect(app).toContain(
      '<ul><li><a href="/?preset=mandel-a">Mandel A</a></li><li><a href="/?preset=mandel-b">Mandel B</a> <span>by Geiss</span></li></ul>',
    );
    expect(app).not.toContain('tunnel-only');
    expect(
      applyHandlers(NOSCRIPT_FALLBACK_SELECTOR).appended.join(''),
    ).not.toContain('?preset=');
  });

  test('leaves non-allowlisted slugs untouched — no doorway-page generation', async () => {
    const response = await onRequest(
      makeContext('https://toil.fyi/discover/some-random-invented-slug'),
    );

    expect(transformCalls).toBe(0);
    expect(recordedHandlers).toHaveLength(0);
    expect(response.status).toBe(200);
  });
});

describe('curated routes on Worker static assets (no SPA fallback)', () => {
  test.each([
    'https://toil.fyi/discover/fractal',
    'https://toil.fyi/author/geiss',
  ])('%s serves the app shell with 200 and its own metadata', async (url) => {
    const { context, assetsFetched } = makeWorkerAssetsContext(url);
    const response = await onRequest(context);

    expect(response.status).toBe(200);
    // The catalog table for the hub's list, then the shell.
    expect(assetsFetched).toEqual(['/preset-meta.json', '/']);
    expect(transformCalls).toBe(1);
    expect(applyHandlers('link[rel="canonical"]').attributes.get('href')).toBe(
      url,
    );
  });

  test.each([
    'https://toil.fyi/discover/some-random-invented-slug',
    'https://toil.fyi/author/made-up-author',
    'https://toil.fyi/anything-else',
  ])(
    '%s stays a 404 so arbitrary paths cannot become doorway pages',
    async (url) => {
      const { context, assetsFetched } = makeWorkerAssetsContext(url);
      const response = await onRequest(context);

      expect(response.status).toBe(404);
      expect(assetsFetched).toEqual([]);
      expect(transformCalls).toBe(0);
    },
  );
});

describe('/author/<slug> middleware', () => {
  test('rewrites a curated author page with person-backed metadata', async () => {
    await onRequest(makeContext('https://toil.fyi/author/geiss'));

    expect(transformCalls).toBe(1);
    expect(applyHandlers('title').innerContent).toContain(
      'Geiss MilkDrop Presets',
    );
    expect(applyHandlers('link[rel="canonical"]').attributes.get('href')).toBe(
      'https://toil.fyi/author/geiss',
    );
    expect(applyHandlers('head').appended.join('')).toContain(
      '"@type":"Person"',
    );
  });

  test('leaves unknown author slugs consolidated onto the root page', async () => {
    const response = await onRequest(
      makeContext('https://toil.fyi/author/made-up-author'),
    );

    expect(transformCalls).toBe(0);
    expect(response.status).toBe(200);
  });
});

describe('/?preset=<id> middleware', () => {
  test('sets a per-preset canonical and title for a known preset', async () => {
    await onRequest(
      makeContext('https://toil.fyi/?preset=test-preset', {
        'test-preset': ['Test Preset', 'Test Author'],
      }),
    );

    expect(transformCalls).toBe(1);

    const canonical = applyHandlers('link[rel="canonical"]');
    expect(canonical.attributes.get('href')).toBe(
      'https://toil.fyi/?preset=test-preset',
    );

    const title = applyHandlers('title');
    expect(title.innerContent).toContain('Test Preset');
    expect(title.innerContent).toContain('Test Author');

    const ogUrl = applyHandlers('meta[property="og:url"]');
    expect(ogUrl.attributes.get('content')).toBe(
      'https://toil.fyi/?preset=test-preset',
    );

    const ogImage = applyHandlers('meta[property="og:image"]');
    expect(ogImage.attributes.get('content')).toBe(
      'https://toil.fyi/api/og-preset?id=test-preset',
    );

    // og:image:url and og:image:secure_url are the same image struct as
    // og:image. Leaving the static aliases in place would make
    // secure_url-preferring unfurlers (Facebook, LinkedIn) show the generic
    // card, so the middleware must rewrite them, not append duplicates.
    for (const alias of ['og:image:url', 'og:image:secure_url']) {
      const aliasEl = applyHandlers(`meta[property="${alias}"]`);
      expect(aliasEl.attributes.get('content')).toBe(
        'https://toil.fyi/api/og-preset?id=test-preset',
      );
    }

    const twitterImage = applyHandlers('meta[name="twitter:image"]');
    expect(twitterImage.attributes.get('content')).toBe(
      'https://toil.fyi/api/og-preset?id=test-preset',
    );

    const head = applyHandlers('head');
    expect(head.appended[0]).not.toContain('og:image:url');
    expect(head.appended[0]).not.toContain('og:image:secure_url');
    expect(head.appended[0]).not.toContain('twitter:player');
    expect(head.appended[0]).not.toContain('property="og:video"');
  });

  test('server-renders an indexable body: image, author link, sibling presets', async () => {
    await onRequest(
      makeContext('https://toil.fyi/?preset=geiss-one', {
        'geiss-one': ['Geiss - One', 'Geiss'],
        'geiss-two': ['Geiss - Two', 'Geiss'],
        'geiss-three': ['Geiss - Three', 'Geiss'],
        'flexi-one': ['Flexi - One', 'Flexi'],
      }),
    );

    const body = applyHandlers(NOSCRIPT_FALLBACK_SELECTOR).appended.join('');
    // The heading drops the "Geiss - " prefix the byline already carries.
    expect(body).toContain('<h1>One</h1>');
    expect(body).toContain(
      '<p>A MilkDrop preset by <a href="/author/geiss">Geiss</a>.</p>',
    );
    expect(body).toContain(
      '<img src="https://toil.fyi/api/og-preset?id=geiss-one"',
    );
    // Byline links the curated author page, whose route knows the author.
    expect(body).toContain('href="/author/geiss"');
    // Siblings by the same author are linked; other authors' presets are not.
    expect(body).toContain('href="/?preset=geiss-two"');
    expect(body).toContain('href="/?preset=geiss-three"');
    expect(body).not.toContain('flexi-one');
    // ...and the preset never links to itself.
    expect(body).not.toContain('href="/?preset=geiss-one"');
  });

  test('links each hand of a credit chain and lists more by each', async () => {
    await onRequest(
      makeContext('https://toil.fyi/?preset=pair', {
        pair: ['Stahlregen + Geiss - Pair', 'Stahlregen + Geiss'],
        'geiss-one': ['Geiss - One', 'Geiss'],
        'stahlregen-one': ['Stahlregen - One', 'Stahlregen'],
      }),
    );

    const body = applyHandlers(NOSCRIPT_FALLBACK_SELECTOR).appended.join('');
    expect(body).toContain(
      '<p>A MilkDrop preset by <a href="/author/stahlregen">Stahlregen</a> + <a href="/author/geiss">Geiss</a>.</p>',
    );
    expect(body).toContain(
      '<h2>More presets by Stahlregen</h2><ul><li><a href="/?preset=stahlregen-one">One</a></li></ul>',
    );
    expect(body).toContain(
      '<h2>More presets by Geiss</h2><ul><li><a href="/?preset=geiss-one">One</a></li></ul>',
    );
  });

  test('links the .milk file the catalog table names', async () => {
    await onRequest(
      makeContext('https://toil.fyi/?preset=geiss-one', {
        'geiss-one': ['Geiss - One', 'Geiss', 1],
      } satisfies PresetMetaTable),
    );

    expect(
      applyHandlers(NOSCRIPT_FALLBACK_SELECTOR).appended.join(''),
    ).toContain(
      '<p><a href="/milkdrop-presets/butterchurn/geiss-one.milk" download>Download .milk</a></p>',
    );
  });

  test('a nameless preset stays playable but carries noindex', async () => {
    await onRequest(
      makeContext('https://toil.fyi/?preset=11', {
        '11': ['11', '', 1, 0, NOINDEX],
      } satisfies PresetMetaTable),
    );

    expect(applyHandlers('meta[name="robots"]').attributes.get('content')).toBe(
      'noindex,follow',
    );
    expect(applyHandlers('link[rel="canonical"]').attributes.get('href')).toBe(
      'https://toil.fyi/?preset=11',
    );
  });

  test('an indexable preset says index', async () => {
    await onRequest(
      makeContext('https://toil.fyi/?preset=geiss-one', {
        'geiss-one': ['Geiss - One', 'Geiss', 0],
      } satisfies PresetMetaTable),
    );

    expect(applyHandlers('meta[name="robots"]').attributes.get('content')).toBe(
      'index,follow',
    );
  });

  test('a copy of another preset names that one as canonical', async () => {
    await onRequest(
      makeContext('https://toil.fyi/?preset=cotc-geiss-one', {
        'geiss-one': ['Geiss - One', 'Geiss', 1],
        'cotc-geiss-one': ['Geiss - One', 'Geiss', 2, 0, 'geiss-one'],
      } satisfies PresetMetaTable),
    );

    for (const [selector, attribute] of [
      ['link[rel="canonical"]', 'href'],
      ['meta[property="og:url"]', 'content'],
    ] as const) {
      expect(applyHandlers(selector).attributes.get(attribute)).toBe(
        'https://toil.fyi/?preset=geiss-one',
      );
    }
    expect(applyHandlers('meta[name="robots"]').attributes.get('content')).toBe(
      'index,follow',
    );
  });

  test('escapes titles in the server-rendered body', async () => {
    await onRequest(
      makeContext('https://toil.fyi/?preset=xss', {
        xss: ['<script>alert(1)</script>', 'Geiss'],
        sibling: ['"><img src=x onerror=alert(1)>', 'Geiss'],
      }),
    );

    const body = applyHandlers(NOSCRIPT_FALLBACK_SELECTOR).appended.join('');
    expect(body).not.toContain('<script>');
    expect(body).not.toContain('<img src=x');
    expect(body).toContain('&lt;script&gt;');
  });

  test('leaves unknown preset ids with the default metadata', async () => {
    await onRequest(
      makeContext('https://toil.fyi/?preset=unknown-id', {
        'test-preset': ['Test Preset', 'Test Author'],
      }),
    );

    expect(transformCalls).toBe(0);
    expect(recordedHandlers).toHaveLength(0);
  });
});

describe('embedded player framing', () => {
  test('allows external framing only for an explicit embed request', async () => {
    const embedded = await onRequest(
      makeContext('https://toil.fyi/?preset=test-preset&embed=true', {
        'test-preset': ['Test Preset', 'Test Author'],
      }),
    );
    const ordinary = await onRequest(makeContext('https://toil.fyi/'));

    expect(embedded.headers.get('x-frame-options')).toBeNull();
    expect(embedded.headers.get('content-security-policy')).toContain(
      'frame-ancestors *',
    );
    expect(ordinary.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });
});

describe('shipped shell (real HTMLRewriter)', () => {
  // The index.html every page is served from. It holds more than one
  // <noscript> (the stylesheet fallback in <head>, the JavaScript-required
  // notice in <body>), and a bare `noscript` selector wrote the page's
  // heading into each of them.
  const shell = readFileSync(join(import.meta.dir, '../../index.html'), 'utf8');

  function shellContext(url: string, presetMeta?: Record<string, unknown>) {
    return {
      request: new Request(url),
      next: () =>
        Promise.resolve(
          new Response(shell, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
        ),
      env: {
        ASSETS: {
          fetch: (request: Request) =>
            Promise.resolve(
              new URL(request.url).pathname === '/preset-meta.json' &&
                presetMeta
                ? new Response(JSON.stringify(presetMeta), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                  })
                : new Response(null, { status: 404 }),
            ),
        },
      },
    };
  }

  beforeEach(() => {
    globalWithRewriter.HTMLRewriter = originalRewriter;
  });

  test.each(['/?preset=geiss-one', '/author/geiss', '/discover/fractal'])(
    '%s writes its heading once, into the body fallback',
    async (path) => {
      expect(typeof globalWithRewriter.HTMLRewriter).toBe('function');
      const response = await onRequest(
        shellContext(`https://toil.fyi${path}`, {
          'geiss-one': ['Geiss - One', 'Geiss'],
          'geiss-two': ['Geiss - Two', 'Geiss'],
        }),
      );
      const html = await response.text();

      expect(html.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
      const fallbackStart = html.indexOf('<noscript id="stims-noscript">');
      expect(fallbackStart).toBeGreaterThan(html.indexOf('<body'));
      const fallback = html.slice(
        fallbackStart,
        html.indexOf('</noscript>', fallbackStart),
      );
      expect(fallback).toContain('<h1>');
    },
  );

  /** The markup inside <div id="app">, which React replaces on mount. */
  function appRoot(html: string): string {
    const start = html.indexOf('<div id="app">');
    const end = html.indexOf('<noscript id="stims-noscript">');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return html.slice(start, end);
  }

  test.each(['/', '/?preset=geiss-one', '/author/geiss', '/discover/fractal'])(
    '%s links /presets/ and every hub in its raw HTML, outside <noscript>',
    async (path) => {
      const response = await onRequest(
        shellContext(`https://toil.fyi${path}`, {
          'geiss-one': ['Geiss - One', 'Geiss'],
        }),
      );
      const app = appRoot(await response.text());
      for (const section of SITE_INDEX_SECTIONS) {
        for (const link of section.links) {
          expect(app).toContain(`<a href="${link.href}">`);
        }
      }
    },
  );

  test('an author page lists its presets inside #app, ahead of the site index', async () => {
    const response = await onRequest(
      shellContext('https://toil.fyi/author/geiss', {
        'geiss-two': ['Geiss - Two', 'Geiss'],
        'stahlregen-geiss': ['Stahlregen + Geiss - Pair', 'Stahlregen + Geiss'],
        'flexi-one': ['Flexi - One', 'Flexi'],
      } satisfies PresetMetaTable),
    );
    const app = appRoot(await response.text());
    const links = [...app.matchAll(/href="(\/\?preset=[^"]+)"/gu)].map(
      (match) => match[1],
    );
    // Every preset crediting Geiss, chains included, A–Z by title.
    expect(links).toEqual(['/?preset=stahlregen-geiss', '/?preset=geiss-two']);
    expect(app.indexOf('stims-collection')).toBeLessThan(
      app.indexOf('<footer'),
    );
  });
});
