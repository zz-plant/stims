import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { onRequest } from '../../functions/_middleware.ts';
import {
  DISCOVER_SLUGS,
  isAllowedDiscoverSlug,
} from '../../functions/discover-slugs.ts';

// The edge middleware is the only thing standing between 1,787 preset URLs
// and a collapsed root canonical — and until now it had zero test coverage,
// so a silent no-op would have shipped unnoticed. Bun has no HTMLRewriter,
// so these tests install a recording mock: selectors and handlers are
// captured, then invoked against fake elements to assert the values the
// middleware would write.

type FakeElement = {
  attributes: Map<string, string>;
  innerContent: string | null;
  appended: string[];
  setAttribute: (name: string, value: string) => void;
  setInnerContent: (value: string) => void;
  append: (value: string, options?: { html?: boolean }) => void;
};

function createFakeElement(): FakeElement {
  const el: FakeElement = {
    attributes: new Map(),
    innerContent: null,
    appended: [],
    setAttribute(name, value) {
      el.attributes.set(name, value);
    },
    setInnerContent(value) {
      el.innerContent = value;
    },
    append(value) {
      el.appended.push(value);
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
    headers: { 'content-type': 'text/html; charset=utf-8' },
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

const globalWithRewriter = globalThis as { HTMLRewriter?: unknown };
let originalRewriter: unknown;

beforeEach(() => {
  recordedHandlers = [];
  transformCalls = 0;
  originalRewriter = globalWithRewriter.HTMLRewriter;
  globalWithRewriter.HTMLRewriter = MockHTMLRewriter;
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
    expect(description.attributes.get('content')).toContain('Fractal');

    const head = applyHandlers('head');
    expect(head.appended.join('')).toContain('application/ld+json');
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
