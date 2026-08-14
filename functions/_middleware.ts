// Edge middleware for preset routes.
//
// Two jobs:
//   1. `/preset/<id>` used to 404 with an empty body even though this file
//      already parsed that shape. It now redirects to the canonical query form.
//   2. `/?preset=<id>` gets real per-preset <title>, description, canonical,
//      og:url and OG image. Before, canonical and og:url stayed pinned to the
//      site root, so every preset told crawlers it was the same page and every
//      social share collapsed onto `/`.

interface EventContext {
  request: Request;
  next: () => Promise<Response>;
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> } };
}

type PresetMeta = Record<string, [title: string, author: string]>;

// Per-isolate memo. Workers reuse isolates across requests, so the metadata
// file is fetched once per isolate rather than once per request. A failed
// fetch is not cached, so a transient error does not poison the isolate.
let presetMetaPromise: Promise<PresetMeta | null> | null = null;

function loadPresetMeta(
  context: EventContext,
  origin: string,
): Promise<PresetMeta | null> {
  presetMetaPromise ??= (async () => {
    const assets = context.env?.ASSETS;
    if (!assets) {
      return null;
    }
    try {
      const response = await assets.fetch(
        new Request(new URL('/preset-meta.json', origin).toString()),
      );
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as PresetMeta;
    } catch {
      return null;
    }
  })().then(
    (value) => {
      if (value === null) {
        presetMetaPromise = null;
      }
      return value;
    },
    () => {
      presetMetaPromise = null;
      return null;
    },
  );

  return presetMetaPromise;
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function onRequest(context: EventContext): Promise<Response> {
  const { request, next } = context;
  const url = new URL(request.url);

  // Immediately skip middleware for static assets or API routes
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/vendor/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/milkdrop-presets/') ||
    url.pathname.startsWith('/api/')
  ) {
    return next();
  }

  // `/preset/<id>` is a real inbound shape (it was linked and parsed here) but
  // the site only serves the app at `/`. Redirect instead of 404ing, and keep
  // a single canonical URL form for crawlers.
  if (url.pathname.startsWith('/preset/')) {
    const pathPresetId = url.pathname.slice('/preset/'.length).split('/')[0];
    if (pathPresetId) {
      let decodedPresetId: string;
      try {
        decodedPresetId = decodeURIComponent(pathPresetId);
      } catch {
        return new Response('Malformed preset id.', { status: 400 });
      }
      const target = new URL('/', url.origin);
      target.searchParams.set('preset', decodedPresetId);
      return Response.redirect(target.toString(), 301);
    }
  }

  const presetId = url.searchParams.get('preset');

  // Fetch standard static response first
  const response = await next();

  // If no preset specified or non-200 or non-HTML response, return original response
  if (
    !presetId ||
    response.status !== 200 ||
    !response.headers.get('content-type')?.includes('text/html')
  ) {
    return response;
  }

  if (typeof HTMLRewriter === 'undefined') {
    return response;
  }

  const presetMeta = await loadPresetMeta(context, url.origin);
  const entry = presetMeta?.[presetId];

  // Unknown ids are left with the site's default metadata. Generating a unique
  // title and canonical for arbitrary `?preset=` values would turn the query
  // string into unbounded crawlable space full of near-duplicate pages.
  if (!entry) {
    return response;
  }

  const [title, author] = entry;
  const authorCredit = author ? ` by ${author}` : '';
  const fullTitle = `${title} — Stims Music Visualizer`;
  const description = `Watch "${title}"${authorCredit} react to your music. A MilkDrop preset running live in your browser on Stims — no install, no plugin.`;

  // Crawlers require absolute image URLs; /api/og-preset rasterizes the
  // per-preset card to PNG via resvg-wasm (SVG is refused by every major
  // unfurler) and falls back to the static card if rendering fails.
  const imageUrl = new URL(
    `/api/og-preset?id=${encodeURIComponent(presetId)}`,
    url.origin,
  ).toString();
  const imageAlt = `Social card for the ${title} preset on Stims`;

  // The URL this page should be indexed and shared as. Must match the form
  // emitted into the sitemap, or the two disagree about what the page is.
  const canonicalUrl = new URL('/', url.origin);
  canonicalUrl.searchParams.set('preset', presetId);
  const canonical = canonicalUrl.toString();

  const setContent = (value: string) => ({
    element(el: { setAttribute: (name: string, value: string) => void }) {
      el.setAttribute('content', value);
    },
  });

  return (
    new HTMLRewriter()
      .on('title', {
        element(el) {
          el.setInnerContent(fullTitle);
        },
      })
      .on('link[rel="canonical"]', {
        element(el) {
          el.setAttribute('href', canonical);
        },
      })
      .on('meta[name="description"]', setContent(description))
      .on('meta[property="og:title"]', setContent(fullTitle))
      .on('meta[property="og:description"]', setContent(description))
      .on('meta[property="og:url"]', setContent(canonical))
      .on('meta[property="og:image"]', setContent(imageUrl))
      .on('meta[property="og:image:alt"]', setContent(imageAlt))
      .on('meta[name="twitter:title"]', setContent(fullTitle))
      .on('meta[name="twitter:description"]', setContent(description))
      .on('meta[name="twitter:image"]', setContent(imageUrl))
      .on('meta[name="twitter:image:alt"]', setContent(imageAlt))
      // A crawler that renders no JavaScript otherwise sees 212 characters of
      // "JavaScript is required". This gives the preset page a real indexable
      // sentence naming the preset and its author.
      .on('noscript', {
        element(el) {
          el.append(
            `<h1>${escapeAttribute(title)}</h1><p>${escapeAttribute(
              `${title}${authorCredit} is a MilkDrop preset you can run live in your browser on Stims.`,
            )}</p>`,
            { html: true },
          );
        },
      })
      .transform(response)
  );
}
