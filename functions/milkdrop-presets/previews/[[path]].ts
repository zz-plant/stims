// Serves preset preview PNGs from the stims-static R2 bucket. Previews are
// generated artifacts (135MB across ~3,600 files) and no longer ship in the
// deploy bundle — scripts/sync-previews-r2.ts publishes them.

interface R2ObjectBody {
  body: ReadableStream;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

interface Env {
  STATIC_R2?: R2Bucket;
}

interface PreviewContext {
  request: Request;
  env: Env;
  params?: { path?: string | string[] };
  waitUntil?: (promise: Promise<unknown>) => void;
}

const CACHE_CONTROL = 'public, max-age=86400, s-maxage=604800, immutable';

function edgeCache(): Cache | null {
  const store = (globalThis as { caches?: { default?: Cache } & CacheStorage })
    .caches;
  return store?.default ?? null;
}

export async function onRequest(context: PreviewContext): Promise<Response> {
  const { request, env } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const cache = edgeCache();
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  if (!env.STATIC_R2) {
    return new Response('Preview store unavailable', { status: 503 });
  }

  const segments = context.params?.path;
  const relative = Array.isArray(segments)
    ? segments.join('/')
    : (segments ?? '');
  const key = `milkdrop-presets/previews/${decodeURIComponent(relative)}`;
  if (!relative || key.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  const object = await env.STATIC_R2.get(key);
  if (!object) {
    return new Response('Not found', {
      status: 404,
      // Negative hits stay short-lived so freshly synced previews appear.
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  }

  const response = new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'image/png',
      'Cache-Control': CACHE_CONTROL,
      ETag: object.httpEtag,
    },
  });
  if (cache) {
    context.waitUntil?.(cache.put(cacheKey, response.clone()));
  }
  return response;
}
