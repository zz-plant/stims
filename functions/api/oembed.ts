// Cloudflare Pages Function: oEmbed 1.0 Provider API for Stims
// Serves GET /api/oembed?url=<encoded-url>&maxwidth=<w>&maxheight=<h>
//
// Enables native interactive embeds in Notion, Medium, Discord, Reddit, Ghost, and Slack.

import type { OEmbedResponse } from '../../src/js/core/edge-contracts.ts';
import { loadPresetMeta } from '../shared/preset-meta.ts';

interface EventContext {
  request: Request;
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> } };
}

// Preset titles come from the MilkDrop corpus and carry raw quotes and angle
// brackets ('martin - "wtf" track'); they must be escaped before landing in
// the iframe's HTML attribute, or the embed HTML breaks — and a hostile
// title becomes an injection vector in every embedding page.
const escapeHtmlAttribute = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// parseInt('abc') is NaN, and Math.max/min pass it straight through — a
// garbage maxwidth used to emit width="NaN" into embed HTML.
const clampEmbedDimension = (
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
) => {
  const parsed = Number.parseInt(raw ?? '', 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, value));
};

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

  const presetMeta = await loadPresetMeta(
    context.env?.ASSETS,
    requestUrl.origin,
  );
  const entry = presetId ? presetMeta?.[presetId] : null;

  const title = entry ? entry[0] : 'Stims — MilkDrop-Inspired Audio Visualizer';
  const author = entry?.[1];
  const authorCredit = author ? ` by ${author}` : '';

  const embedWidth = clampEmbedDimension(
    requestUrl.searchParams.get('maxwidth'),
    800,
    320,
    1280,
  );
  const embedHeight = clampEmbedDimension(
    requestUrl.searchParams.get('maxheight'),
    450,
    240,
    720,
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
    html: `<iframe src="${escapeHtmlAttribute(iframeSrc)}" width="${embedWidth}" height="${embedHeight}" style="border:0;border-radius:12px;overflow:hidden;" allow="autoplay; microphone; display-capture" allowfullscreen title="${escapeHtmlAttribute(`${title}${authorCredit}`)}"></iframe>`,
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
