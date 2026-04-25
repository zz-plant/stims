// Minimal offline-first service worker for Stims
// Caches the app shell (HTML, CSS, JS) so the library/shell stays functional
// when offline. The visualizer itself needs audio input, so full offline
// functionality is about keeping navigation and toy browsing available.

const CACHE_NAME = 'stims-shell-v2';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/assets/css/base.css',
  '/assets/css/index.css',
  '/manifest.json',
  '/icons/favicon.svg',
  '/icons/favicon-32.png',
  '/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(SHELL_ASSETS);
    })(),
  );
  // Activate immediately so stale versions don't linger
  self.skipWaiting();
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
  // Only handle navigation requests and static assets
  // Let dynamic module imports and API calls pass through to network
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip browser extension requests
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    (async () => {
      // Try network first for the freshest content
      try {
        const networkResponse = await fetch(request);
        // Cache successful responses for future offline use
        if (networkResponse.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone());
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
