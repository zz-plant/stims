// Cloudflare Pages Middleware: Intercepts preset routes to dynamically rewrite Open Graph & Twitter meta tags

interface EventContext {
  request: Request;
  next: () => Promise<Response>;
}

function humanizePresetId(presetId: string): {
  title: string;
  author?: string;
} {
  const parts = presetId.split('-');
  const formatted = parts
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  // Common author prefix patterns in MilkDrop presets (e.g. rovastar-parallel-universe -> Rovastar)
  if (parts.length >= 2) {
    const potentialAuthor =
      parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    const titlePart = parts
      .slice(1)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    return { title: titlePart, author: potentialAuthor };
  }

  return { title: formatted };
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

  // Extract preset ID from query param ?preset=<id> or path /preset/<id>
  let presetId = url.searchParams.get('preset');
  if (!presetId && url.pathname.startsWith('/preset/')) {
    presetId = url.pathname.replace('/preset/', '').split('/')[0];
  }

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

  const { title, author } = humanizePresetId(presetId);
  const authorCredit = author ? `by ${author}` : null;
  const fullTitle = `${title}${authorCredit ? ` ${authorCredit}` : ''} — Stims Music Visualizer`;
  const description = `Experience "${title}"${authorCredit ? ` by ${author}` : ''} live on Stims music visualizer. High-fidelity audio-reactive visuals in your browser, WebGPU accelerated.`;
  const ogImageUrl = `https://toil.fyi/api/og-preset?id=${encodeURIComponent(presetId)}`;

  // Use Cloudflare HTMLRewriter to substitute Open Graph / Twitter tags dynamically
  // HTMLRewriter is provided natively by Cloudflare Workers runtime
  if (typeof HTMLRewriter !== 'undefined') {
    return new HTMLRewriter()
      .on('title', {
        element(el) {
          el.setInnerContent(fullTitle);
        },
      })
      .on('meta[property="og:title"]', {
        element(el) {
          el.setAttribute('content', fullTitle);
        },
      })
      .on('meta[property="og:description"]', {
        element(el) {
          el.setAttribute('content', description);
        },
      })
      .on('meta[property="og:image"]', {
        element(el) {
          el.setAttribute('content', ogImageUrl);
        },
      })
      .on('meta[property="og:image:type"]', {
        element(el) {
          el.setAttribute('content', 'image/svg+xml');
        },
      })
      .on('meta[name="twitter:title"]', {
        element(el) {
          el.setAttribute('content', fullTitle);
        },
      })
      .on('meta[name="twitter:description"]', {
        element(el) {
          el.setAttribute('content', description);
        },
      })
      .on('meta[name="twitter:image"]', {
        element(el) {
          el.setAttribute('content', ogImageUrl);
        },
      })
      .transform(response);
  }

  return response;
}
