// Led Zeppelin service worker — makes the editor installable + runnable offline.
//
// Strategy is NETWORK-FIRST for same-origin GETs: on localhost / a live daemon
// the network is instant, so you always get fresh code (no stale-cache pain
// during development), and the cache is purely an offline safety net. Live
// daemon endpoints (/api/*) and the frame socket (/frames) are never cached.
const VERSION = 'lz-v1';

// Minimal app shell precached on install so the editor opens offline even on the
// very first launch after install. Everything else (the rest of the ES modules,
// thumbnails, etc.) is cached on demand by the fetch handler below.
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './src/ui/ui.css',
  './src/app.js',
  './fonts/SplineSansMono.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();   // a new SW takes over promptly (dev-friendly)
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE).catch(() => { /* a missing asset must not abort install */ })));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));   // drop old versions
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never touch writes
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // let cross-origin pass through untouched
  if (url.pathname.startsWith('/api/')) return;           // live daemon API — always hit the network
  if (url.pathname === '/frames') return;                 // ws upgrade (not really a fetch) — guard anyway

  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      // Cache a copy of good same-origin responses for offline use.
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => { /* quota / opaque */ });
      }
      return res;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {                       // offline page load → serve the app shell
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw new Error('offline and not cached');
    }
  })());
});
