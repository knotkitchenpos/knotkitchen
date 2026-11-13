/* KnotKitchen Partners service worker: phone alerts (web push) only.
 *
 * Shows each alert from the API (a store locked, a wallet low, a large
 * refund, dishes out of stock) even with no Partners tab open, and opens or
 * focuses Partners at the right page when tapped. It caches nothing.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "KnotKitchen Partners", {
      body: data.body || "",
      icon: "/partners/icons/icon-192.png",
      badge: "/partners/icons/icon-192.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || "/partners/" },
    }),
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
          const r = await fetch("/partners/api/alerts", { credentials: "include" });
          if (!r.ok) return; // signed out on this device
          key = keyBytes((await r.json()).data.publicKey);
        }
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      await fetch("/partners/api/alerts/subscribe", {
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
  const target = new URL(event.notification.data?.url || "/partners/", self.location.origin);
  // Only ever a Partners page on this site.
  const url = target.origin === self.location.origin && target.pathname.startsWith("/partners/") ? target.href : new URL("/partners/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const tab = open.find((c) => new URL(c.url).pathname.startsWith("/partners/"));
      if (tab) {
        await tab.focus();
        if ("navigate" in tab) await tab.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
