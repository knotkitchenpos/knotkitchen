// Bumped to v3: hashed build assets are now cached as they load, so the till
// opens with no internet (orders then wait in the offline queue).
const CACHE_NAME = "knotkitchen-shell-v3";
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
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Never cache API responses: the queue and the per-store caches handle offline data.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io")) return;

  // Vite's hashed assets never change under the same name: cache first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((res) => {
            if (res.ok) caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else (the shell, icons, sounds): network first, cache behind it.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok && event.request.mode === "navigate") caches.open(CACHE_NAME).then((c) => c.put("/", res.clone()));
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))),
  );
});