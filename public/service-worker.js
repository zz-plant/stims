// Offline-first service worker for Stims
// Caches the app shell so navigation stays functional offline.
// Hashed assets (/assets/*) are immutable with 1-year Cache-Control
// and are served from browser HTTP cache — no SW intervention needed.

const CACHE_NAME = 'stims-shell-v10';
// Keep this list to what the shell needs to paint offline. The full preset
// catalog (~1.5 MB) is deliberately absent: the app loads a 20 KB starter
// catalog first and defers the full one to a background task, and precaching
// it here would pull the whole payload during install anyway. The fetch
// handler still caches it opportunistically once that background load runs.
const CORE_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/favicon.svg',
  '/icons/favicon-32.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const OPTIONAL_SHELL_ASSETS = [
  '/screenshots/hero-narrow.png',
  '/screenshots/hero-wide.png',
  '/milkdrop-presets/previews/eos-dark-side-of-the-moon-clean-mix.png',
  '/milkdrop-presets/previews/rovastar-mosaics-of-ages.png',
  '/milkdrop-presets/previews/geiss-bipolar-x.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Activation must not advertise offline support unless the actual app
      // shell is complete. Marketing images and preset previews remain
      // best-effort so a renamed decorative asset cannot strand an update.
      await cache.addAll(CORE_SHELL_ASSETS);
      await Promise.all(
        OPTIONAL_SHELL_ASSETS.map((asset) =>
          cache.add(asset).catch(() => {
            // A missing optional asset must not block activation.
          }),
        ),
      );
      self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      // Take control of all clients immediately
      clients.claim();
    })(),
  );
});

// Large, slowly-changing payloads (the 1.7 MB preset catalog, textures,
// previews) are served cache-first with a background refresh. Waiting on the
// network for these on every load penalized exactly the repeat visits the
// cache exists for; one-load staleness after a deploy is the accepted trade.
const STALE_WHILE_REVALIDATE_PREFIXES = ['/milkdrop-presets/', '/textures/'];

function offlineResponse() {
  return new Response('Offline — please check your connection.', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain' },
  });
}

// Queue the cache write on event.waitUntil: it keeps the worker alive until
// the write completes (the reason the write used to block the response)
// without holding the response itself hostage to storage latency. Quota or
// storage failures stay non-fatal.
function queueCacheWrite(event, request, response) {
  const write = caches
    .open(CACHE_NAME)
    .then((cache) => cache.put(request, response))
    .catch(() => {});
  if (event.waitUntil) {
    event.waitUntil(write);
  }
}

async function staleWhileRevalidate(event, request) {
  const cached = await caches.match(request);
  // `cache: 'no-cache'` forces a conditional revalidation at the origin
  // (cheap 304 via ETag when unchanged). A plain fetch here reads the HTTP
  // cache, whose own stale-while-revalidate headers can hand back the exact
  // stale copy this refresh exists to replace — layering the two caches
  // stretched "one-load staleness after a deploy" into an hour or more.
  const refresh = fetch(request, { cache: 'no-cache' }).then(
    (networkResponse) => {
      if (networkResponse.ok) {
        queueCacheWrite(event, request, networkResponse.clone());
      }
      return networkResponse;
    },
  );

  if (cached) {
    if (event.waitUntil) {
      event.waitUntil(refresh.catch(() => {}));
    }
    return cached;
  }

  try {
    return await refresh;
  } catch (_networkError) {
    return offlineResponse();
  }
}

async function networkFirst(event, request) {
  try {
    const networkResponse = await fetch(request);
    const contentType = networkResponse.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html');

    // Only cache non-HTML or navigation responses when successful
    if (networkResponse.ok && (request.mode === 'navigate' || !isHtml)) {
      queueCacheWrite(event, request, networkResponse.clone());
    }
    return networkResponse;
  } catch (_networkError) {
    // Network failed, try the cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;

    // For navigation requests, fall back to the cached index.html
    if (request.mode === 'navigate') {
      const shellResponse = await caches.match('/index.html');
      if (shellResponse) return shellResponse;
    }

    return offlineResponse();
  }
}

// Share target. An installed Stims can receive audio files and links from
// other apps; the browser POSTs the payload to this path, and since it is a
// static site with nothing serving that route, the worker has to answer it.
const SHARE_TARGET_PATH = '/share-target';
/** Where a shared file waits for the page to pick it up. */
const SHARED_AUDIO_KEY = '/__stims-shared-audio';
/** Its own cache, so clearing the shell cache on upgrade cannot drop a
    share that arrived seconds earlier. */
const SHARE_CACHE_NAME = 'stims-share-inbox-v1';

function redirectTo(path) {
  return Response.redirect(new URL(path, self.location.origin).href, 303);
}

async function handleSharedPayload(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch (_error) {
    // A malformed share is still a launch: open the app rather than an error.
    return redirectTo('/');
  }

  const file = formData.get('media');
  if (file && typeof file !== 'string' && file.size > 0) {
    const cache = await caches.open(SHARE_CACHE_NAME);
    // The name travels as a header because a Response body carries none, and
    // the picker's status copy ("Playing <name>") is the same copy here.
    await cache.put(
      SHARED_AUDIO_KEY,
      new Response(file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Stims-Shared-Name': encodeURIComponent(
            file.name || 'Shared audio',
          ),
        },
      }),
    );
    return redirectTo('/?share=audio');
  }

  // Deliberately not parsed here. The app already owns a YouTube reference
  // parser, and this worker is plain unbundled JS that cannot import it — so
  // the raw text is handed over intact rather than growing a second copy of
  // that regex to drift against the first.
  const shared = ['url', 'text', 'title']
    .map((field) => formData.get(field))
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .join(' ');
  if (shared) {
    return redirectTo(`/?share=link&u=${encodeURIComponent(shared)}`);
  }
  return redirectTo('/');
}

self.addEventListener('fetch', (event) => {
  // Only handle GET requests for http(s)
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method === 'POST' &&
    url.origin === self.location.origin &&
    url.pathname === SHARE_TARGET_PATH
  ) {
    event.respondWith(handleSharedPayload(request));
    return;
  }

  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;
  if (url.origin !== self.location.origin) return;

  // Bypass service worker for immutable hashed assets (/assets/*)
  // Browser HTTP cache handles immutable assets; bypassing SW prevents SPA 404 HTML fallback pollution.
  if (url.pathname.startsWith('/assets/')) return;

  // Bypass service worker for API calls
  if (url.pathname.startsWith('/api/')) return;

  // The stashed share only ever exists in the inbox cache; a miss must read
  // as "nothing shared" rather than falling through to the network and
  // returning the SPA shell as if it were an audio file.
  //
  // Taking it empties it. Someone else's audio file has no business sitting
  // in this origin's storage after the one launch it was shared for, and a
  // share that fails to arrive must not replay the previous one instead.
  if (url.pathname === SHARED_AUDIO_KEY) {
    event.respondWith(
      (async () => {
        try {
          const cache = await caches.open(SHARE_CACHE_NAME);
          const hit = await cache.match(SHARED_AUDIO_KEY);
          if (!hit) return new Response(null, { status: 404 });
          // Delete after the body is read, not before: deleting a cache entry
          // whose Response is still streaming can abort the read.
          const taken = new Response(await hit.blob(), {
            headers: hit.headers,
          });
          if (event.waitUntil) {
            event.waitUntil(cache.delete(SHARED_AUDIO_KEY).catch(() => {}));
          } else {
            await cache.delete(SHARED_AUDIO_KEY).catch(() => {});
          }
          return taken;
        } catch (_error) {
          return new Response(null, { status: 404 });
        }
      })(),
    );
    return;
  }

  if (
    STALE_WHILE_REVALIDATE_PREFIXES.some((prefix) =>
      url.pathname.startsWith(prefix),
    )
  ) {
    event.respondWith(staleWhileRevalidate(event, request));
    return;
  }

  event.respondWith(networkFirst(event, request));
});
