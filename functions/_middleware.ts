// Edge middleware for preset routes.
//
// Two jobs:
//   1. `/preset/<id>` used to 404 with an empty body even though this file
//      already parsed that shape. It now redirects to the canonical query form.
//   2. `/?preset=<id>` gets real per-preset <title>, description, canonical,
//      og:url and OG image. Before, canonical and og:url stayed pinned to the
//      site root, so every preset told crawlers it was the same page and every
//      social share collapsed onto `/`.

import { resolveSemanticRoute } from './discover-slugs.ts';
import { presentTitle } from './shared/preset-title.ts';

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

function isEmbedRequest(url: URL) {
  return ['embedded', 'preview', 'embed', 'chromeless'].some(
    (key) => url.searchParams.get(key) === 'true',
  );
}

function allowExternalFraming(response: Response, enabled: boolean) {
  if (!enabled) return response;

  const headers = new Headers(response.headers);
  headers.delete('x-frame-options');

  const directives = (headers.get('content-security-policy') ?? '')
    .split(';')
    .map((directive) => directive.trim())
    .filter(
      (directive) =>
        directive.length > 0 &&
        !directive.toLowerCase().startsWith('frame-ancestors '),
    );
  directives.push('frame-ancestors *');
  headers.set('content-security-policy', directives.join('; '));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest(context: EventContext): Promise<Response> {
  const { request, next } = context;
  const url = new URL(request.url);
  const embedRequest = isEmbedRequest(url);

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

  // Curated semantic topic and author pages. Unknown slugs fall through to
  // the root-canonical shell so arbitrary paths cannot mint doorway pages.
  const semanticRoute = resolveSemanticRoute(url.pathname);
  if (semanticRoute) {
    const isAuthor = semanticRoute.kind === 'author';
    const fullTitle = isAuthor
      ? `${semanticRoute.label} MilkDrop Presets — Stims`
      : `${semanticRoute.label} Music Visualizers — Stims`;
    const description = semanticRoute.description;
    const canonical = new URL(url.pathname, url.origin).toString();
    const oembedUrl = new URL(
      `/api/oembed?url=${encodeURIComponent(canonical)}`,
      url.origin,
    ).toString();

    const response = await next();
    if (
      response.status !== 200 ||
      !response.headers.get('content-type')?.includes('text/html')
    ) {
      return response;
    }
    if (typeof HTMLRewriter === 'undefined') return response;

    const setContent = (value: string) => ({
      element(el: { setAttribute: (name: string, value: string) => void }) {
        el.setAttribute('content', value);
      },
    });

    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: fullTitle,
      description,
      url: canonical,
      ...(isAuthor
        ? {
            mainEntity: {
              '@type': 'Person',
              name: semanticRoute.label,
            },
          }
        : {}),
      isPartOf: {
        '@type': 'SoftwareApplication',
        name: 'Stims',
        url: url.origin,
      },
    });

    const rewritten = new HTMLRewriter()
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
      .on('meta[name="twitter:title"]', setContent(fullTitle))
      .on('meta[name="twitter:description"]', setContent(description))
      .on('head', {
        element(el) {
          el.append(
            `<link rel="alternate" type="application/json+oembed" href="${escapeAttribute(oembedUrl)}" title="${escapeAttribute(fullTitle)}" /><script type="application/ld+json">${jsonLd}</script>`,
            { html: true },
          );
        },
      })
      .on('noscript', {
        element(el) {
          el.append(
            `<h1>${escapeAttribute(
              isAuthor
                ? `${semanticRoute.label} MilkDrop Presets`
                : `${semanticRoute.label} Music Visualizers`,
            )}</h1><p>${escapeAttribute(description)}</p>`,
            { html: true },
          );
        },
      })
      .transform(response);
    return allowExternalFraming(rewritten, embedRequest);
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
    return allowExternalFraming(response, embedRequest);
  }

  if (typeof HTMLRewriter === 'undefined') {
    return allowExternalFraming(response, embedRequest);
  }

  const presetMeta = await loadPresetMeta(context, url.origin);
  const entry = presetMeta?.[presetId];

  // Unknown ids are left with the site's default metadata. Generating a unique
  // title and canonical for arbitrary `?preset=` values would turn the query
  // string into unbounded crawlable space full of near-duplicate pages.
  if (!entry) {
    return allowExternalFraming(response, embedRequest);
  }

  const [rawTitle, author] = entry;
  // preset-meta titles carry the author as a prefix ("Rovastar - Parallel
  // Universe"), so using them raw next to a byline printed the name twice.
  const title = presentTitle(rawTitle, author);
  const authorCredit = author ? ` by ${author}` : '';
  const fullTitle = `${title}${authorCredit} — MilkDrop preset on Stims`;
  const description = `${title}${authorCredit} — a MilkDrop-inspired visualizer preset you can watch react to any song, your microphone, or audio from another tab. Live in your browser, no install.`;

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

  const oembedUrl = new URL(
    `/api/oembed?url=${encodeURIComponent(canonical)}`,
    url.origin,
  ).toString();

  const setContent = (value: string) => ({
    element(el: { setAttribute: (name: string, value: string) => void }) {
      el.setAttribute('content', value);
    },
  });

  // Inject preset-specific JSON-LD structured data for search engine rich snippets
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VisualArtwork',
        name: title,
        description,
        ...(author ? { artist: { '@type': 'Person', name: author } } : {}),
        image: imageUrl,
        url: canonical,
        isPartOf: {
          '@type': 'SoftwareApplication',
          name: 'Stims',
          url: url.origin,
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: url.origin,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Presets',
            item: canonical,
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: title,
            item: canonical,
          },
        ],
      },
    ],
  });

  const playerUrl = new URL('/', url.origin);
  playerUrl.searchParams.set('preset', presetId);
  playerUrl.searchParams.set('embedded', 'true');
  const embedPlayerUrl = playerUrl.toString();

  const speculationRulesJson = JSON.stringify({
    prefetch: [
      {
        source: 'list',
        urls: [
          '/milkdrop-presets/catalog.json',
          `/milkdrop-presets/previews/${encodeURIComponent(presetId)}.png`,
        ],
      },
    ],
  });

  const rewritten = new HTMLRewriter()
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
    .on('meta[name="twitter:card"]', setContent('summary_large_image'))
    .on('meta[name="twitter:title"]', setContent(fullTitle))
    .on('meta[name="twitter:description"]', setContent(description))
    .on('meta[name="twitter:image"]', setContent(imageUrl))
    .on('meta[name="twitter:image:alt"]', setContent(imageAlt))
    .on('head', {
      element(el) {
        el.append(
          `<link rel="alternate" type="application/json+oembed" href="${escapeAttribute(oembedUrl)}" title="${escapeAttribute(fullTitle)}" /><meta name="twitter:player" content="${escapeAttribute(embedPlayerUrl)}" /><meta name="twitter:player:width" content="1200" /><meta name="twitter:player:height" content="630" /><meta property="og:video" content="${escapeAttribute(embedPlayerUrl)}" /><meta property="og:video:type" content="text/html" /><meta property="og:video:width" content="1200" /><meta property="og:video:height" content="630" /><script type="application/ld+json">${jsonLd}</script><script type="speculationrules">${speculationRulesJson}</script>`,
          {
            html: true,
          },
        );
      },
    })
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
    .transform(response);
  return allowExternalFraming(rewritten, embedRequest);
}
