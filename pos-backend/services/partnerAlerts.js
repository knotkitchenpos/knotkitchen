const webpush = require("web-push");

/**
 * Phone alerts for the Partners dashboard (owner, 2026-11-13): web push to
 * every device an owner switched it on for, about any of their linked stores.
 *
 *   locked      a store was locked (wallet or plan)
 *   walletLow   a store's wallet fell below the owner's amount
 *   largeRefund a refund at or above the owner's amount
 *   stockOut    dishes switched off because an inventory item ran out
 *
 * Signed with the same VAPID key as CSD's push (services/csdPush getKeys).
 * Nothing here may fail or slow what caused it: every entry point runs after
 * the caller has moved on and swallows its own errors.
 */

const DEFAULTS = Object.freeze({
  locked: true,
  walletLow: true,
  walletLowBelow: 1000, // rupees
  largeRefund: true,
  largeRefundAbove: 1000, // rupees
  stockOut: true,
});

const num = (v, d, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d;
};

/** An owner's settings, defaults filled in and amounts kept sane. */
const prefsOf = (raw = {}) => ({
  locked: raw.locked !== undefined ? Boolean(raw.locked) : DEFAULTS.locked,
  walletLow: raw.walletLow !== undefined ? Boolean(raw.walletLow) : DEFAULTS.walletLow,
  walletLowBelow: num(raw.walletLowBelow, DEFAULTS.walletLowBelow, 1, 10000000),
  largeRefund: raw.largeRefund !== undefined ? Boolean(raw.largeRefund) : DEFAULTS.largeRefund,
  largeRefundAbove: num(raw.largeRefundAbove, DEFAULTS.largeRefundAbove, 1, 10000000),
  stockOut: raw.stockOut !== undefined ? Boolean(raw.stockOut) : DEFAULTS.stockOut,
});

/** Did this debit take the wallet from at-or-above the line to below it? Paise in, rupees line. */
const crossedBelow = (balanceAfterPaise, debitPaise, belowRupees) => {
  const line = belowRupees * 100;
  return balanceAfterPaise < line && balanceAfterPaise + debitPaise >= line;
};

const rupeeLabel = (rupees) => `₹${Number(rupees || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Send one notification to every device of a partner. Gone devices are removed. */
const sendToPartner = async (partnerId, { title, body, url = "/partners/", tag = "" }) => {
  const { PartnerPushSubscription } = require("../models/partnerPushModel");
  const subs = await PartnerPushSubscription.find({ partnerId }).lean();
  if (!subs.length) return { sent: 0, removed: 0 };
  const keys = await require("./csdPush").getKeys();
  const payload = JSON.stringify({ title: clip(title, 80), body: clip(body, 180), url: String(url).slice(0, 300), tag: clip(tag, 80) });
  const options = {
    vapidDetails: { subject: process.env.WEB_PUSH_SUBJECT || "mailto:support@knotkitchen.com", publicKey: keys.publicKey, privateKey: keys.privateKey },
    TTL: 60 * 60 * 6,
    urgency: "high",
    timeout: 10000,
  };
  let sent = 0;
  const gone = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, options);
        sent += 1;
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) gone.push(s._id);
        else console.warn("[partner-alerts] send failed:", err?.statusCode || "", String(err?.body || err?.message || "").slice(0, 200));
      }
    }),
  );
  if (gone.length) await PartnerPushSubscription.deleteMany({ _id: { $in: gone } });
  if (sent) await PartnerPushSubscription.updateMany({ partnerId, _id: { $nin: gone } }, { $set: { lastSentAt: new Date() } });
  return { sent, removed: gone.length };
};

/** Once per key per partner within `hours`: true when this call may send. */
const firstWithin = async (partnerId, key, hours) => {
  const { PartnerAlertMark } = require("../models/partnerPushModel");
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const res = await PartnerAlertMark.updateOne(
    { partnerId, key, at: { $lt: since } },
    { $set: { at: new Date() } },
  );
  if (res.modifiedCount) return true;
  try {
    await PartnerAlertMark.create({ partnerId, key, at: new Date() });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false; // sent recently
    throw err;
  }
};

/**
 * Alert every partner a store is linked to. `build(prefs)` returns the
 * notification, or null when this partner's settings say no.
 */
const alertStore = async (restaurantId, { key, hours = 0, build }) => {
  const { PartnerLink, PartnerAccount } = require("../models/partnerModel");
  const links = await PartnerLink.find({ restaurantId }).select("partnerId storeId").lean();
  if (!links.length) return 0;
  const Restaurant = require("../models/restaurantModel");
  const store = await Restaurant.findById(restaurantId).select("name").lean();
  const name = store?.name || `Store ${links[0].storeId}`;
  let sent = 0;
  for (const link of links) {
    const partner = await PartnerAccount.findById(link.partnerId).select("alerts").lean();
    if (!partner) continue;
    const note = build(prefsOf(partner.alerts || {}), name, link.storeId);
    if (!note) continue;
    if (hours && !(await firstWithin(link.partnerId, `${key}:${restaurantId}`, hours))) continue;
    sent += (await sendToPartner(link.partnerId, note)).sent;
  }
  return sent;
};

/** Run later, never throw: the caller has already done its job. */
const later = (fn) => {
  setImmediate(() => {
    Promise.resolve()
      .then(fn)
      .catch((err) => console.warn("[partner-alerts]", err?.message));
  });
};

const storeLocked = (restaurantId, reason = "") =>
  later(() =>
    alertStore(restaurantId, {
      key: "locked",
      hours: 6,
      build: (p, name) => (p.locked ? { title: `${name} is locked`, body: clip(reason, 160) || "Top up or renew the plan to unlock it.", url: "/partners/billing", tag: `locked-${restaurantId}` } : null),
    }),
  );

const walletMoved = (restaurantId, balanceAfterPaise, debitPaise) =>
  later(() =>
    alertStore(restaurantId, {
      key: "walletLow",
      hours: 12,
      build: (p, name) =>
        p.walletLow && crossedBelow(balanceAfterPaise, debitPaise, p.walletLowBelow)
          ? { title: `${name}: wallet low`, body: `Wallet is ${rupeeLabel(balanceAfterPaise / 100)}, below your ${rupeeLabel(p.walletLowBelow)} alert. Top up to avoid a lock.`, url: "/partners/topup", tag: `wallet-${restaurantId}` }
          : null,
    }),
  );

const refundGiven = (restaurantId, { amount, orderNumber = "", by = "" }) =>
  later(() =>
    alertStore(restaurantId, {
      key: "refund",
      build: (p, name) =>
        p.largeRefund && Number(amount) >= p.largeRefundAbove
          ? { title: `${name}: refund ${rupeeLabel(amount)}`, body: `${orderNumber ? `Order ${orderNumber}` : "An order"} refunded${by ? ` by ${clip(by, 40)}` : ""}.`, url: "/partners/staff-watch", tag: "" }
          : null,
    }),
  );

const stockOut = (restaurantId, names = []) =>
  later(() =>
    alertStore(restaurantId, {
      key: `stock:${names.slice().sort().join("|").slice(0, 200)}`,
      hours: 12,
      build: (p, name) =>
        p.stockOut && names.length
          ? { title: `${name}: out of stock`, body: `Switched off: ${clip(names.slice(0, 5).join(", "), 140)}${names.length > 5 ? ` and ${names.length - 5} more` : ""}.`, url: "/partners/inventory", tag: `stock-${restaurantId}` }
          : null,
    }),
  );

module.exports = { DEFAULTS, prefsOf, crossedBelow, sendToPartner, alertStore, storeLocked, walletMoved, refundGiven, stockOut };
