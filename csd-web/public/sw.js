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
    icon: "/icons/icon-192.png",
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
