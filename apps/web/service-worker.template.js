/* Generated with the production asset manifest. No API responses or journals in this cache. */
const CACHE_NAME = __CACHE_NAME__;
const ASSETS = __ASSETS__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then((cache) => cache.addAll(ASSETS))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Existing tabs can be several releases behind; their hashed assets remain usable.
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate" && (url.pathname === "/" || url.pathname === "/play")) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => (await cache.match(url.pathname)) || fetch(event.request)));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => (await cache.match(url.pathname)) || fetch(event.request)));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const names = (await caches.keys()).filter((name) => name.startsWith("vsm-shell-")).reverse();
      for (const name of names) {
        const cached = await (await caches.open(name)).match(url.pathname);
        if (cached) return cached;
      }
      return fetch(event.request);
    })());
  }
});
