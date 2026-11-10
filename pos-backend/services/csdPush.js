const webpush = require("web-push");
const { CsdPushSubscription, WebPushKey } = require("../models/csdPushModel");
const CsdStaff = require("../models/csdStaffModel");

/**
 * Sends CSD web push notifications (the browser's own push service: Google's
 * for Chrome/Android, Apple's for Safari/iPhone, Mozilla's for Firefox).
 * Free, no app needed; each device opts in from CSD.
 */

const KEY_ID = "csd-vapid";
const SUBJECT = () => process.env.WEB_PUSH_SUBJECT || "mailto:support@knotkitchen.com";

let cached = null;

/** The VAPID key pair: from the environment, else the database, else made now. */
const getKeys = async () => {
  if (cached) return cached;
  const envPub = String(process.env.WEB_PUSH_PUBLIC_KEY || "").trim();
  const envPriv = String(process.env.WEB_PUSH_PRIVATE_KEY || "").trim();
  if (envPub && envPriv) {
    cached = { publicKey: envPub, privateKey: envPriv };
    return cached;
  }
  let row = await WebPushKey.findById(KEY_ID).lean();
  if (!row) {
    const fresh = webpush.generateVAPIDKeys();
    try {
      await WebPushKey.create({ _id: KEY_ID, ...fresh });
    } catch (err) {
      if (err?.code !== 11000) throw err; // another instance made it first: use theirs
    }
    row = await WebPushKey.findById(KEY_ID).lean();
  }
  cached = { publicKey: row.publicKey, privateKey: row.privateKey };
  return cached;
};

const publicKey = async () => (await getKeys()).publicKey;

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * Send one notification to every device of the given staff (all active staff
 * when staffIds is omitted). Devices the push service says are gone are
 * removed. Never throws: a notification failing must not fail what caused it.
 */
const notify = async ({ title, body, url = "/", tag = "" }, { staffIds } = {}) => {
  try {
    const keys = await getKeys();
    const active = await CsdStaff.find(
      { status: "active", ...(staffIds ? { _id: { $in: staffIds } } : {}) },
      { _id: 1 }
    ).lean();
    if (!active.length) return { sent: 0, removed: 0 };
    const subs = await CsdPushSubscription.find({ staffId: { $in: active.map((s) => s._id) } }).lean();
    if (!subs.length) return { sent: 0, removed: 0 };

    const payload = JSON.stringify({ title: clip(title, 80), body: clip(body, 180), url: String(url).slice(0, 300), tag: clip(tag, 80) });
    const options = {
      vapidDetails: { subject: SUBJECT(), publicKey: keys.publicKey, privateKey: keys.privateKey },
      TTL: 60 * 60, // an hour-old "new message" alert is no longer news
      urgency: "high",
      timeout: 10000,
    };

    let sent = 0;
    const gone = [];
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, options);
        sent += 1;
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) gone.push(s._id);
        else console.error("[push] send failed:", err?.statusCode || "", String(err?.body || err?.message || "").slice(0, 200)); // eslint-disable-line no-console
      }
    }));
    if (gone.length) await CsdPushSubscription.deleteMany({ _id: { $in: gone } });
    if (sent) await CsdPushSubscription.updateMany({ _id: { $in: subs.map((s) => s._id).filter((id) => !gone.some((g) => String(g) === String(id))) } }, { $set: { lastSentAt: new Date() } });
    return { sent, removed: gone.length };
  } catch (err) {
    console.error("[push] notify failed:", err?.message); // eslint-disable-line no-console
    return { sent: 0, removed: 0, error: err?.message };
  }
};

/** A new customer WhatsApp message: everyone with push on hears about it. */
const notifyWhatsApp = (conv, message) => {
  const who = conv.customName || conv.profileName || `+${conv.waId}`;
  const label = { image: "📷 Photo", video: "🎥 Video", audio: "🎤 Voice message", document: "📄 Document", sticker: "Sticker" }[message.type];
  const text = clip(message.body, 160);
  return notify({
    title: who,
    body: label ? (text ? `${label}: ${text}` : label) : text || "New message",
    url: `/chat?tab=whatsapp&c=${conv._id}`,
    tag: `wa-${conv._id}`, // a newer message from the same customer replaces the older alert
  });
};

/**
 * Only the browsers' push services: the server POSTs to whatever endpoint is
 * stored, so an arbitrary URL here would let a signed-in user make the API
 * call any host (server-side request forgery).
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge (Chromium), Android
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/, // Safari, iPhone home-screen apps
  /^(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com$/, // Firefox
  /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/, // legacy Edge
];
const pushHostOk = (endpoint) => {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((rx) => rx.test(u.hostname));
  } catch {
    return false;
  }
};

const isValidSubscription = (s) =>
  !!s && typeof s === "object" &&
  typeof s.endpoint === "string" && s.endpoint.length <= 2000 && pushHostOk(s.endpoint) &&
  typeof s.keys?.p256dh === "string" && /^[A-Za-z0-9_-]{40,200}={0,2}$/.test(s.keys.p256dh) &&
  typeof s.keys?.auth === "string" && /^[A-Za-z0-9_-]{8,100}={0,2}$/.test(s.keys.auth);

module.exports = { getKeys, publicKey, notify, notifyWhatsApp, isValidSubscription, _reset: () => { cached = null; } };
