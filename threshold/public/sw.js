const CACHE = 'threshold-v1';
const SCOPE = new URL('./', self.location).href;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const html = await (await fetch(SCOPE, { cache: 'reload' })).text();
    const urls = new Set([SCOPE, SCOPE + 'manifest.webmanifest', SCOPE + 'apple-touch-icon.png',
      SCOPE + 'icons/icon-192.png', SCOPE + 'icons/icon-512.png', SCOPE + 'icons/maskable-512.png']);
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) urls.add(new URL(m[1], SCOPE).href);
    await Promise.all([...urls].map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Same-origin GETs only: stale-while-revalidate. Open-Meteo calls go straight to the network.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const r = await net;
    if (r) return r;
    if (req.mode === 'navigate') return (await cache.match(SCOPE)) || Response.error();
    return Response.error();
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all[0]) await all[0].focus().catch(() => {});
    else await self.clients.openWindow(SCOPE);
  })());
});
