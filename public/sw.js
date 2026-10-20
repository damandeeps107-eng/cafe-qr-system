// The Royal Cafe POS — Service Worker for Desktop PWA Installation
const CACHE_NAME = 'royal-cafe-pos-v2';

// Static assets to cache for offline shell
const STATIC_ASSETS = [
  '/',
  '/kitchen.css',
  '/kitchen.js',
  '/vendor/qrcode.min.js',
  '/images/icon-192.png',
  '/images/icon-512.png'
];

// Install — Pre-cache core shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => 
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — Network-first for API calls (NEVER cache orders), Cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // NEVER cache API calls — orders must always be real-time
  if (url.pathname.startsWith('/api')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For navigation requests (HTML pages), always go network-first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets: Cache-first, fallback to network
  event.respondWith(
    caches.match(event.request)
      .then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          // Cache successful responses for static assets
          if (response && response.status === 200 && response.type === 'basic') {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          }
          return response;
        });
      })
  );
});
