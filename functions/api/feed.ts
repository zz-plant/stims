// Cloudflare Pages Function: Dynamic JSON Feed 1.1 & RSS API for Stims Presets
// Serves GET /api/feed

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
  const url = new URL(request.url);

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

  const presetMeta = await loadPresetMeta(context, url.origin);
  const entries = presetMeta ? Object.entries(presetMeta).slice(0, 50) : [];

  const items = entries.map(([id, [title, author]]) => {
    const authorCredit = author ? ` by ${author}` : '';
    const presetUrl = `${url.origin}/?preset=${encodeURIComponent(id)}`;
    const imageUrl = `${url.origin}/api/og-preset?id=${encodeURIComponent(id)}`;

    return {
      id: presetUrl,
      url: presetUrl,
      title: `${title}${authorCredit}`,
      summary: `Watch "${title}"${authorCredit} react live to your music in your browser on Stims — no install, no plugins required.`,
      image: imageUrl,
      banner_image: imageUrl,
      date_published: new Date().toISOString(),
      author: author ? { name: author } : { name: 'Stims Community' },
      tags: ['milkdrop', 'audio-visualizer', 'webgl', 'webgpu'],
      _stims: {
        preset_id: id,
        agent_url: `${url.origin}/?preset=${encodeURIComponent(id)}&agent=true`,
        og_card_url: imageUrl,
      },
    };
  });

  const feedData = {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Stims — Featured Music Visualizers Feed',
    home_page_url: url.origin,
    feed_url: `${url.origin}/api/feed`,
    description: 'Live feed of MilkDrop audio visualizers and presets running in your browser on Stims.',
    icon: `${url.origin}/icons/icon-512.png`,
    favicon: `${url.origin}/icons/favicon-32.png`,
    items,
  };

  return new Response(JSON.stringify(feedData, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/feed+json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
