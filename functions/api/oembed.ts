// Cloudflare Pages Function: oEmbed 1.0 Provider API for Stims
// Serves GET /api/oembed?url=<encoded-url>&maxwidth=<w>&maxheight=<h>
//
// Enables native interactive embeds in Notion, Medium, Discord, Reddit, Ghost, and Slack.

import type { OEmbedResponse } from '../../src/js/core/edge-contracts.ts';

interface EventContext {
  request: Request;
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> } };
}

type PresetMeta = Record<string, [title: string, author: string]>;

let presetMetaPromise: Promise<PresetMeta | null> | null = null;

function loadPresetMeta(
  context: EventContext,
  origin: string,
): Promise<PresetMeta | null> {
  presetMetaPromise ??= (async () => {
    const assets = context.env?.ASSETS;
    if (!assets) return null;
    try {
      const response = await assets.fetch(
        new Request(new URL('/preset-meta.json', origin).toString()),
      );
      if (!response.ok) return null;
      return (await response.json()) as PresetMeta;
    } catch {
      return null;
    }
  })().then(
    (val) => {
      if (val === null) presetMetaPromise = null;
      return val;
    },
    () => {
      presetMetaPromise = null;
      return null;
    },
  );

  return presetMetaPromise;
}

export async function onRequest(context: EventContext): Promise<Response> {
  const { request } = context;
  const requestUrl = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const targetUrlStr = requestUrl.searchParams.get('url');
  if (!targetUrlStr) {
    return new Response(
      JSON.stringify({ error: 'Missing required "url" parameter' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(targetUrlStr);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid "url" parameter' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Parse preset ID from target URL query or pathname
  let presetId = targetUrl.searchParams.get('preset');
  if (!presetId && targetUrl.pathname.startsWith('/preset/')) {
    presetId =
      targetUrl.pathname.slice('/preset/'.length).split('/')[0] || null;
  }

  const presetMeta = await loadPresetMeta(context, requestUrl.origin);
  const entry = presetId ? presetMeta?.[presetId] : null;

  const title = entry ? entry[0] : 'Stims — MilkDrop-Inspired Audio Visualizer';
  const author = entry && entry[1] ? entry[1] : undefined;
  const authorCredit = author ? ` by ${author}` : '';

  const embedWidth = Math.min(
    1280,
    Math.max(
      320,
      parseInt(requestUrl.searchParams.get('maxwidth') || '800', 10),
    ),
  );
  const embedHeight = Math.min(
    720,
    Math.max(
      240,
      parseInt(requestUrl.searchParams.get('maxheight') || '450', 10),
    ),
  );

  const iframeSrc = presetId
    ? `${requestUrl.origin}/?preset=${encodeURIComponent(presetId)}&embed=true`
    : `${requestUrl.origin}/?embed=true`;

  const ogImageUrl = presetId
    ? `${requestUrl.origin}/api/og-preset?id=${encodeURIComponent(presetId)}`
    : `${requestUrl.origin}/og/milkdrop.png`;

  // `satisfies` (not a runtime parse) so field drift fails `bun run typecheck`
  // instead of turning a malformed embed into a 500 on a cached edge route.
  const oembedData = {
    type: 'rich',
    version: '1.0',
    title: `${title}${authorCredit}`,
    author_name: author || 'Stims',
    author_url: requestUrl.origin,
    provider_name: 'Stims',
    provider_url: requestUrl.origin,
    cache_age: 86400,
    thumbnail_url: ogImageUrl,
    thumbnail_width: 1200,
    thumbnail_height: 630,
    html: `<iframe src="${iframeSrc}" width="${embedWidth}" height="${embedHeight}" style="border:0;border-radius:12px;overflow:hidden;" allow="autoplay; microphone; display-capture" allowfullscreen title="${title}"></iframe>`,
    width: embedWidth,
    height: embedHeight,
  } satisfies OEmbedResponse;

  return new Response(JSON.stringify(oembedData, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
