/* KnotKitchen Rider service worker.
 *
 *   - New-delivery alerts (web push), shown even with the app closed, and
 *     opening the right delivery when tapped.
 *   - An offline-friendly shell: the app's page and its built files are kept,
 *     so the app opens with no signal and says so, instead of a browser error.
 *     API calls are never cached: a delivery is always the server's latest.
 */

// v2: new app icon (🛵); the old cache, with the old icons, is dropped on activate.
const SHELL = "kk-rider-shell-v2";
const HOME = "/rider/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll([HOME, "/rider/manifest.webmanifest", "/rider/icons/icon-192.png"]))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== SHELL) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/rider/")) return;
  if (url.pathname.startsWith("/rider/api/") || url.pathname.startsWith("/rider/socket.io/")) return;

  // Pages: the network first (a new release shows at once), the kept shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL);
          cache.put(HOME, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          return (await caches.match(HOME)) || new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
    return;
  }

  // Built files are named by their content: keep each once fetched.
  if (url.pathname.startsWith("/rider/assets/") || url.pathname.startsWith("/rider/icons/") || url.pathname.startsWith("/rider/sounds/")) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone()).catch(() => {});
        return res;
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      // Tell an open app at once, so it refreshes and rings.
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      open.forEach((c) => c.postMessage({ type: "rider-push", data }));
      await self.registration.showNotification(data.title || "KnotKitchen Rider", {
        body: data.body || "",
        icon: "/rider/icons/icon-192.png",
        badge: "/rider/icons/badge-96.png",
        tag: data.tag || undefined,
        renotify: Boolean(data.tag),
        requireInteraction: /New Delivery/i.test(data.title || ""),
        vibrate: [300, 120, 300, 120, 300],
        data: { url: data.url || HOME },
      });
    })(),
  );
});

/* The browser replaced this device's subscription: send the new one straight away. */
const keyBytes = (b64) => {
  const raw = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      let sub = event.newSubscription;
      if (!sub) {
        let key = event.oldSubscription?.options?.applicationServerKey;
        if (!key) {
          const r = await fetch("/rider/api/push", { credentials: "include" });
          if (!r.ok) return; // signed out on this device
          key = keyBytes((await r.json()).data.publicKey);
        }
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      await fetch("/rider/api/push/subscribe", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
    })().catch(() => {}),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || HOME, self.location.origin);
  // Only ever a Rider page on this site.
  const url = target.origin === self.location.origin && target.pathname.startsWith("/rider/") ? target.href : new URL(HOME, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const tab = open.find((c) => new URL(c.url).pathname.startsWith("/rider/"));
      if (tab) {
        await tab.focus();
        tab.postMessage({ type: "rider-open", url: target.pathname + target.search });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
