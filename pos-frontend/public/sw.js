// Bumped to v2 with the icon rename: `activate` purges every cache whose name
// doesn't match, so this is what evicts the stale v1 shell holding the old icon.
const CACHE_NAME = "knotkitchen-shell-v2";
// addAll() rejects the whole install if any entry 404s, so every URL here must
// exist in public/.
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/favicon-32.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
  );
});