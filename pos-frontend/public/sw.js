/*
 * KnotKitchen POS service worker: the till opens and works with no internet.
 *
 * - On install it stores EVERY file of this build (the list is written in by
 *   vite.config.js at build time), so the Orders, Tables and Settings pages
 *   work offline even if nobody opened them online since the last deploy.
 * - Each deploy changes the build id below, so the browser installs the new
 *   worker, stores the new files, and drops the old cache when it takes over.
 * - Pages (the app shell): the network, but only for 4 seconds; then the
 *   stored copy. "Wi-Fi connected but no internet" used to hang the app on
 *   the loading screen, or on the offline page, for up to a minute.
 * - API calls are never cached here: the offline queue and the per-store
 *   saved copies handle data (utils/offlineQueue, utils/savedCopy).
 *
 * In the Android app the page itself is fetched through Capacitor, which adds
 * its native bridge to the HTML: the shell is therefore stored from real page
 * loads (with that bridge), and at install it is asked for as a page
 * (Accept: text/html) so it carries the bridge too.
 */
const BUILD_ID = "__KK_BUILD_ID__";
const PRECACHE = ["__KK_PRECACHE__"];
const CACHE_NAME = `knotkitchen-shell-${BUILD_ID}`;
const SHELL = "/";
const NAV_TIMEOUT_MS = 4000;
const EXTRA = ["/manifest.webmanifest", "/icons/favicon-32.png"];

const storeAll = async (cache, urls) =>
  // One by one, never addAll: a single missing file must not stop the till
  // from storing all the others.
  Promise.allSettled(
    urls.map((url) =>
      fetch(url, { cache: "no-cache" }).then((res) => (res.ok ? cache.put(url, res) : undefined)),
    ),
  );

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Paths only: an unbuilt copy (never registered in dev) lists none.
      const files = PRECACHE.filter((f) => f.startsWith("/"));
      await storeAll(cache, [...files, ...EXTRA]);
      // The shell, asked for as a page so the app's bridge comes with it.
      try {
        const res = await fetch(new Request(new URL(SHELL, self.location.origin).href, { headers: { Accept: "text/html" }, cache: "no-cache" }));
        if (res.ok) await cache.put(SHELL, res);
      } catch {
        // Offline while installing: the previous cache keeps serving until the next try.
        throw new Error("offline during install");
      }
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("knotkitchen-shell-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Any cache of ours, newest first: a file from the build before still beats nothing. */
const fromCache = async (request) => (await caches.match(request)) || undefined;

const keepShell = (res) => {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE_NAME).then((c) => c.put(SHELL, copy));
  }
  return res;
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io")) return;

  // Opening the app, or any page of it: network for up to 4 s, then the stored shell.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const network = fetch(request).then(keepShell);
        network.catch(() => {}); // a late failure after the stored shell was shown is not an error
        const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS));
        try {
          const first = await Promise.race([network, timeout]);
          if (first) return first;
        } catch {
          /* offline: fall through to the stored shell */
        }
        const cached = (await fromCache(SHELL)) || (await fromCache(request));
        if (cached) return cached;
        // Nothing stored yet (first ever open): wait for the network after all.
        return network;
      })(),
    );
    return;
  }

  // Build files never change under the same name: stored copy first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      fromCache(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Icons, sounds, the manifest: network first, stored copy behind it.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => fromCache(request).then((cached) => cached || Response.error())),
  );
});
