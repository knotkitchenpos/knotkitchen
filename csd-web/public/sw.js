/* KnotKitchen Business (CSD) service worker: web push only.
 *
 * Shows a notification for each push from the API (a new customer WhatsApp
 * message), even when no CSD tab is open, and opens or focuses CSD at the
 * right chat when it is tapped. It caches nothing: CSD is always loaded fresh.
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
  const title = data.title || "KnotKitchen Business";
  const options = {
    body: data.body || "New message",
    icon: "/icons/icon-192.png?v=2",
    badge: "/icons/badge-96.png",
    tag: data.tag || undefined,
    // A newer message from the same customer replaces the alert, and still buzzes.
    renotify: !!data.tag,
    data: { url: data.url || "/chat?tab=whatsapp" },
  };
  event.waitUntil((async () => {
    // An open CSD tab plays its own sound and refreshes its counts now.
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) c.postMessage({ type: "kk:push", data });
    await self.registration.showNotification(title, options);
  })());
});

/**
 * The browser replaced this device's push subscription (Firefox does it now
 * and then; others after a key or service change). Re-register the new one
 * with the API straight away, so alerts keep coming without anyone having to
 * open CSD first. The old one is dropped by the server when it next 410s.
 */
const apiBase = (() => {
  try {
    const u = new URL(new URL(self.location.href).searchParams.get("api") || "");
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    return u.protocol === "https:" || local ? u.href.replace(/\/$/, "") : "";
  } catch {
    return "";
  }
})();

const keyBytes = (b64) => {
  const raw = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

self.addEventListener("pushsubscriptionchange", (event) => {
  if (!apiBase) return;
  event.waitUntil((async () => {
    let sub = event.newSubscription;
    if (!sub) {
      let key = event.oldSubscription?.options?.applicationServerKey;
      if (!key) {
        const r = await fetch(`${apiBase}/push`, { credentials: "include" });
        if (!r.ok) return; // signed out on this device: nothing to keep on
        key = keyBytes((await r.json()).data.publicKey);
      }
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    await fetch(`${apiBase}/push/subscribe`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  })().catch(() => {}));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/chat?tab=whatsapp", self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) {
      await tab.focus();
      tab.postMessage({ type: "kk:open", url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
