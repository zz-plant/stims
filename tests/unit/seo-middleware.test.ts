import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { onRequest } from '../../functions/_middleware.ts';
import {
  AUTHOR_SLUGS,
  DISCOVER_SLUGS,
  isAllowedAuthorSlug,
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

  test('leaves non-allowlisted slugs untouched — no doorway-page generation', async () => {
    const response = await onRequest(
      makeContext('https://toil.fyi/discover/some-random-invented-slug'),
    );

    expect(transformCalls).toBe(0);
    expect(recordedHandlers).toHaveLength(0);
    expect(response.status).toBe(200);
  });
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

    const head = applyHandlers('head');
    expect(head.appended[0]).toContain('property="og:image:url"');
    expect(head.appended[0]).toContain('property="og:image:secure_url"');
    expect(head.appended[0]).not.toContain('twitter:player');
    expect(head.appended[0]).not.toContain('property="og:video"');
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
