// Service worker for the phone companion (scope: /control/). Same network-first
// approach as the main app: fresh when the daemon is reachable, cached shell so
// the home-screen app still opens (showing "connecting…") when it isn't. The
// frame/control socket (/frames) and live API are never cached.
const VERSION = 'lz-remote-v1';
const CORE = ['./', './index.html', './remote.js', './manifest.webmanifest', '../favicon.svg', '../icons/icon-180.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE).catch(() => { /* a missing asset must not abort install */ })));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;     // live daemon API — network only
  if (url.pathname === '/frames') return;           // ws — guard

  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw new Error('offline and not cached');
    }
  })());
});
