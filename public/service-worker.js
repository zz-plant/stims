// Offline-first service worker for Stims
// Caches the app shell so navigation stays functional offline.
// Hashed assets (/assets/*) are immutable with 1-year Cache-Control
// and are served from browser HTTP cache — no SW intervention needed.

const CACHE_NAME = 'stims-shell-v9';
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

self.addEventListener('fetch', (event) => {
  // Only handle GET requests for http(s)
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // Bypass service worker for immutable hashed assets (/assets/*)
  // Browser HTTP cache handles immutable assets; bypassing SW prevents SPA 404 HTML fallback pollution.
  if (url.pathname.startsWith('/assets/')) return;

  // Bypass service worker for API calls
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      // Try network first for the freshest content
      try {
        const networkResponse = await fetch(request);
        const contentType = networkResponse.headers.get('content-type') || '';
        const isHtml = contentType.includes('text/html');

        // Only cache non-HTML or navigation responses when successful
        if (networkResponse.ok && (request.mode === 'navigate' || !isHtml)) {
          const cache = await caches.open(CACHE_NAME);
          // Keep the worker alive until the write completes; otherwise the
          // browser may terminate it after returning the network response.
          try {
            await cache.put(request, networkResponse.clone());
          } catch (_cacheWriteError) {
            // Runtime caching is opportunistic. A quota or storage failure
            // must never turn a successful network response into a 503.
          }
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

        // Nothing cached, return a simple offline response
        return new Response('Offline — please check your connection.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })(),
  );
});
