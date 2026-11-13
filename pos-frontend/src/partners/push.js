import { partnersApi } from "./api";

/**
 * Phone alerts on this device: register the Partners service worker
 * (partners/public/partners-sw.js, scope /partners/), subscribe it with the
 * server's push key, and tell the API. Same approach as CSD's (csd-web).
 */

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent || "");
export const isIOS = () => /iPad|iPhone|iPod/.test(ua()) || (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches) || navigator.standalone === true;
export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Why alerts cannot be switched on here, or "" when they can. */
export const pushBlocker = () => {
  if (isIOS() && !isStandalone()) return "ios-install";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "";
};

let registration = null;
const registerWorker = async () => {
  if (registration) return registration;
  registration = await navigator.serviceWorker.register("/partners/partners-sw.js", { scope: "/partners/", updateViaCache: "none" });
  return registration;
};

const keyBytes = (base64url) => {
  const raw = atob((base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** This device: { state: "on" | "off" | blocker }, plus the settings from the server. */
export const alertState = async () => {
  const blocker = pushBlocker();
  let sub = null;
  if (!blocker) sub = await (await registerWorker()).pushManager.getSubscription();
  const data = (await partnersApi.alerts(sub?.endpoint)).data.data;
  if (blocker) return { ...data, state: blocker };
  if (!sub) return { ...data, state: "off" };
  if (!data.subscribed) {
    try {
      await partnersApi.alertsSubscribe(sub.toJSON());
    } catch {
      return { ...data, state: "off" };
    }
  }
  return { ...data, state: "on" };
};

export const enableAlerts = async (publicKey) => {
  const blocker = pushBlocker();
  if (blocker) throw Object.assign(new Error(blocker), { code: blocker });
  if ((await Notification.requestPermission()) !== "granted") throw Object.assign(new Error("denied"), { code: "denied" });
  const reg = await registerWorker();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub?.options?.applicationServerKey) {
    const have = new Uint8Array(sub.options.applicationServerKey);
    const want = keyBytes(publicKey);
    if (have.length !== want.length || have.some((b, i) => b !== want[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await partnersApi.alertsSubscribe(sub.toJSON());
};

export const disableAlerts = async () => {
  const sub = await (await registerWorker()).pushManager.getSubscription();
  if (!sub) return;
  try {
    await partnersApi.alertsUnsubscribe(sub.endpoint);
  } finally {
    await sub.unsubscribe();
  }
};
