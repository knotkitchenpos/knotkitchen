import { riderApi } from "./api";

/**
 * Delivery alerts on this device: the Rider service worker
 * (rider/public/rider-sw.js, scope /rider/), subscribed with the server's
 * push key. Same approach as the Partners dashboard.
 */
const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent || "");
export const isIOS = () => /iPad|iPhone|iPod/.test(ua()) || (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches) || navigator.standalone === true;
export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Why alerts can't be on here, or "". */
export const pushBlocker = () => {
  if (isIOS() && !isStandalone()) return "ios-install";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "";
};

let registration = null;
export const registerWorker = async () => {
  if (registration) return registration;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  registration = await navigator.serviceWorker.register("/rider/rider-sw.js", { scope: "/rider/", updateViaCache: "none" });
  return registration;
};

const keyBytes = (b64) => {
  const raw = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const currentSubscription = async () => {
  if (pushBlocker()) return null;
  const reg = await registerWorker();
  return reg ? reg.pushManager.getSubscription() : null;
};

export const currentEndpoint = async () => {
  try {
    return (await currentSubscription())?.endpoint || "";
  } catch {
    return "";
  }
};

/** "on" | "off" | a blocker. Re-sends a subscription the server lost. */
export const pushState = async () => {
  const blocker = pushBlocker();
  if (blocker) return blocker;
  const sub = await currentSubscription();
  if (!sub || Notification.permission !== "granted") return "off";
  const info = await riderApi.push(sub.endpoint);
  if (!info.subscribed) await riderApi.pushSubscribe(sub.toJSON());
  return "on";
};

export const enablePush = async () => {
  const blocker = pushBlocker();
  if (blocker) throw Object.assign(new Error(blocker), { code: blocker });
  if ((await Notification.requestPermission()) !== "granted") throw Object.assign(new Error("denied"), { code: "denied" });
  const reg = await registerWorker();
  await navigator.serviceWorker.ready;
  const { publicKey } = await riderApi.push();
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
  await riderApi.pushSubscribe(sub.toJSON());
};

export const disablePush = async () => {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await riderApi.pushUnsubscribe(sub.endpoint);
  } finally {
    await sub.unsubscribe();
  }
};
