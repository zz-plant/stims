// Edge middleware for preset routes.
//
// Four jobs:
//   1. `/preset/<id>` used to 404 with an empty body even though this file
//      already parsed that shape. It now redirects to the canonical query form.
//   2. `/?preset=<id>` gets real per-preset <title>, description, canonical,
//      og:url and OG image. Before, canonical and og:url stayed pinned to the
//      site root, so every preset told crawlers it was the same page and every
//      social share collapsed onto `/`. A preset the catalog table marks
//      noindex, or as a copy of another, says so in its robots or canonical.
//   3. Curated `/discover/<slug>` and `/author/<slug>` routes get the app
//      shell plus their own metadata (there is no file behind those paths),
//      and every preset in their collection as links inside #app.
//   4. A retired `/discover/<slug>` redirects to the page that replaced it.

import {
  resolveSemanticRoute,
  retiredDiscoverTarget,
  semanticRouteHeading,
} from './discover-slugs.ts';
import {
  buildHubCollectionContent,
  collectionSectionHtml,
} from './shared/collection-page.ts';
import { loadPresetMeta, presetIndexing } from './shared/preset-meta.ts';
import {
  buildPresetPageContent,
  CREDIT_SEPARATOR,
  PRESET_DOWNLOAD_LABEL,
  presetPageHref,
} from './shared/preset-page.ts';

/**
 * The one <noscript> that carries page content for crawlers that run no
 * JavaScript: the body's fallback in index.html. A bare `noscript` selector
 * also matched the stylesheet fallback in <head> and any other <noscript> the
 * build adds, so every page shipped its heading several times over.
 */
export const NOSCRIPT_FALLBACK_SELECTOR = 'noscript#stims-noscript';

/**
 * The React root. Content the edge writes here is real DOM in the raw HTML,
 * not <noscript>; React replaces it on mount with the same content, rendered
 * by the workspace (CollectionPageDetails, SiteIndexFooter).
 */
export const APP_ROOT_SELECTOR = 'div#app';

interface EventContext {
  request: Request;
  next: () => Promise<Response>;
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> } };
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

  const retiredTarget = retiredDiscoverTarget(url.pathname);
  if (retiredTarget) {
    const target = new URL(retiredTarget, url.origin);
    target.search = url.search;
    return Response.redirect(target.toString(), 301);
  }

  // Curated semantic topic and author pages. Unknown slugs fall through to
  // the root-canonical shell so arbitrary paths cannot mint doorway pages.
  const semanticRoute = resolveSemanticRoute(url.pathname);
  if (semanticRoute) {
    const isAuthor = semanticRoute.kind === 'author';
    const heading = semanticRouteHeading(semanticRoute);
    const fullTitle = `${heading} — Stims`;
    const description = semanticRoute.description;
    const canonical = new URL(url.pathname, url.origin).toString();
    const oembedUrl = new URL(
      `/api/oembed?url=${encodeURIComponent(canonical)}`,
      url.origin,
    ).toString();

    // The catalog table (memoized per isolate) and the shell, in parallel.
    const [presetMeta, shellResponse] = await Promise.all([
      loadPresetMeta(context.env?.ASSETS, url.origin),
      next(),
    ]);
    const collection = presetMeta
      ? buildHubCollectionContent(presetMeta, semanticRoute)
      : null;

    let response = shellResponse;
    // Worker static assets, unlike the Pages project this site ran on, do not
    // fall back to index.html for unknown paths, so a curated route such as
    // /discover/fractal has no file and `next()` answers 404 with an empty
    // body. These routes are real pages rendered by the app shell (the client
    // parses the path), so serve the shell for them. Unknown slugs never reach
    // this branch and keep their 404, which is what stops arbitrary paths
    // from becoming doorway pages.
    if (response.status === 404 && context.env?.ASSETS) {
      response = await context.env.ASSETS.fetch(
        new Request(new URL('/', url.origin)),
      );
    }
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
      .on(NOSCRIPT_FALLBACK_SELECTOR, {
        element(el) {
          el.append(
            `<h1>${escapeAttribute(heading)}</h1><p>${escapeAttribute(description)}</p>`,
            { html: true },
          );
        },
      })
      // The collection itself, as links a crawler reads from the raw HTML.
      // Before, the only list was Browse's, rendered client-side and
      // virtualized, so the raw HTML of every hub held no preset link.
      .on(APP_ROOT_SELECTOR, {
        element(el) {
          if (collection && collection.count > 0) {
            el.prepend(collectionSectionHtml(collection), { html: true });
          }
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

  const presetMeta = await loadPresetMeta(context.env?.ASSETS, url.origin);
  const page = presetMeta ? buildPresetPageContent(presetMeta, presetId) : null;

  // Unknown ids are left with the site's default metadata. Generating a unique
  // title and canonical for arbitrary `?preset=` values would turn the query
  // string into unbounded crawlable space full of near-duplicate pages.
  if (!page) {
    return allowExternalFraming(response, embedRequest);
  }

  // preset-meta titles carry the author as a prefix ("Rovastar - Parallel
  // Universe"); the page model strips it so the byline does not print the
  // name twice.
  const { title, author } = page;
  const authorCredit = author ? ` by ${author}` : '';
  const fullTitle = `${title}${authorCredit} — MilkDrop Preset on Stims`;
  const description = `${title}${authorCredit} — a MilkDrop preset you can watch react to any song, your microphone, or audio from another tab. Live in your browser, no install.`;

  // Crawlers require absolute image URLs; /api/og-preset rasterizes the
  // per-preset card to PNG via resvg-wasm (SVG is refused by every major
  // unfurler) and falls back to the static card if rendering fails. The index
  // shell ships og:image:url and og:image:secure_url aliases pointed at the
  // static card; per the OG spec those are the same image struct as og:image,
  // so they must be rewritten too — parsers that prefer secure_url (Facebook,
  // LinkedIn) would otherwise show the generic card for every preset.
  const imageUrl = new URL(
    `/api/og-preset?id=${encodeURIComponent(presetId)}`,
    url.origin,
  ).toString();
  const imageAlt = `Social card for the ${title} preset on Stims`;

  // The URL this page should be indexed and shared as. Must match the form
  // emitted into the sitemap, or the two disagree about what the page is. A
  // copy of another preset (same name, same credit) names that one.
  const indexing = presetIndexing(presetMeta?.[presetId] ?? ['', '']);
  const canonical = new URL(
    presetPageHref(indexing.kind === 'canonical' ? indexing.id : presetId),
    url.origin,
  ).toString();

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

  // What a crawler that reads only the HTML sees for this preset: the same
  // heading, byline, sibling presets and topic hubs the workspace renders
  // below the stage (PresetPageDetails.tsx), plus the preview card and a link
  // into the app.
  const linkHtml = (href: string, text: string) =>
    `<a href="${escapeAttribute(href)}">${escapeAttribute(text)}</a>`;
  const byline = page.credits.length
    ? `A MilkDrop preset by ${page.credits
        .map((credit) =>
          credit.href
            ? linkHtml(credit.href, credit.name)
            : escapeAttribute(credit.name),
        )
        .join(escapeAttribute(CREDIT_SEPARATOR))}.`
    : 'A MilkDrop preset.';
  const relatedSection = page.related
    .map(
      (group) =>
        `<h2>More presets by ${escapeAttribute(group.author)}</h2><ul>${group.presets
          .map((related) => `<li>${linkHtml(related.href, related.title)}</li>`)
          .join('')}</ul>`,
    )
    .join('');
  const download = page.download
    ? `<p><a href="${escapeAttribute(page.download)}" download>${escapeAttribute(PRESET_DOWNLOAD_LABEL)}</a></p>`
    : '';
  const presetBodyHtml = `<h1>${escapeAttribute(title)}</h1><p>${byline}</p>${download}<p><img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(imageAlt)}" width="1200" height="630"></p>${relatedSection}`;

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
    // Nameless presets ("11") and the projectM test fixtures stay playable
    // and listed, but out of the index (see buildPresetMetaMap).
    .on(
      'meta[name="robots"]',
      setContent(
        indexing.kind === 'noindex' ? 'noindex,follow' : 'index,follow',
      ),
    )
    .on('meta[property="og:title"]', setContent(fullTitle))
    .on('meta[property="og:description"]', setContent(description))
    .on('meta[property="og:url"]', setContent(canonical))
    .on('meta[property="og:image"]', setContent(imageUrl))
    .on('meta[property="og:image:url"]', setContent(imageUrl))
    .on('meta[property="og:image:secure_url"]', setContent(imageUrl))
    .on('meta[property="og:image:alt"]', setContent(imageAlt))
    .on('meta[name="twitter:card"]', setContent('summary_large_image'))
    .on('meta[name="twitter:title"]', setContent(fullTitle))
    .on('meta[name="twitter:description"]', setContent(description))
    .on('meta[name="twitter:image"]', setContent(imageUrl))
    .on('meta[name="twitter:image:alt"]', setContent(imageAlt))
    .on('head', {
      element(el) {
        el.append(
          `<link rel="alternate" type="application/json+oembed" href="${escapeAttribute(oembedUrl)}" title="${escapeAttribute(fullTitle)}" /><script type="application/ld+json">${jsonLd}</script><script type="speculationrules">${speculationRulesJson}</script>`,
          {
            html: true,
          },
        );
      },
    })
    // A crawler that renders no JavaScript otherwise sees 212 characters of
    // "JavaScript is required". Crawlers that do render JavaScript skip
    // <noscript> and read the copy the workspace renders instead.
    .on(NOSCRIPT_FALLBACK_SELECTOR, {
      element(el) {
        el.append(presetBodyHtml, { html: true });
      },
    })
    .transform(response);
  return allowExternalFraming(rewritten, embedRequest);
}
