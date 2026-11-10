import { push as pushApi } from "../api";

/**
 * Web push on this device: register the service worker (public/sw.js),
 * subscribe it with the server's VAPID key, and tell the API.
 */

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent || "");
export const isIOS = () => /iPad|iPhone|iPod/.test(ua()) || (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches) || navigator.standalone === true;

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Why push cannot be switched on here, or "" when it can. */
export const pushBlocker = () => {
  if (isIOS() && !isStandalone()) return "ios-install";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "";
};

let registration = null;
export const registerWorker = async () => {
  if (!("serviceWorker" in navigator)) return null;
  if (registration) return registration;
  // updateViaCache "none": always fetch sw.js fresh, so a new release reaches every device.
  registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return registration;
};

const keyBytes = (base64url) => {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** This device's current state: on (subscribed here), off, or why it cannot be. */
export const pushState = async () => {
  const blocker = pushBlocker();
  if (blocker) return { state: blocker };
  const reg = await registerWorker();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { state: "off" };
  const server = await pushApi.get(sub.endpoint);
  // The browser still has it but the server dropped it (or another key): re-send it.
  if (!server.subscribed) {
    try { await pushApi.subscribe(sub.toJSON()); } catch { return { state: "off" }; }
  }
  return { state: "on" };
};

export const enablePush = async () => {
  const blocker = pushBlocker();
  if (blocker) throw Object.assign(new Error(blocker), { code: blocker });
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw Object.assign(new Error("denied"), { code: "denied" });
  const reg = await registerWorker();
  await navigator.serviceWorker.ready;
  const { publicKey } = await pushApi.get();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different server key cannot be reused.
  if (sub && sub.options?.applicationServerKey) {
    const have = new Uint8Array(sub.options.applicationServerKey);
    const want = keyBytes(publicKey);
    if (have.length !== want.length || have.some((b, i) => b !== want[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await pushApi.subscribe(sub.toJSON());
  return "on";
};

export const disablePush = async () => {
  const reg = await registerWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    try { await pushApi.unsubscribe(sub.endpoint); } finally { await sub.unsubscribe(); }
  }
  return "off";
};

/** A short two-note chime for a new message while CSD is open (no audio file needed). */
let audioCtx = null;
export const chime = () => {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t = audioCtx.currentTime;
    [[880, 0], [1320, 0.12]].forEach(([f, d]) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + d);
      o.stop(t + d + 0.3);
    });
  } catch {
    /* no audio here: the badge and title still show it */
  }
};
