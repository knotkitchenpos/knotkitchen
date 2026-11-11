const mongoose = require("mongoose");
const Store = require("../models/storeModel");
const Order = require("../models/orderModel");
const { BusinessBalance } = require("../models/businessBalanceModel");
const { PlatformSubscription } = require("../models/platformSubscriptionModel");
const CsdStoreCharges = require("../models/csdStoreChargesModel");

/**
 * Which active stores need attention, and why. Read-only; everything is one
 * query per data source, joined here.
 *
 * Devices live in KKMDM's own database on the same cluster. If that cannot be
 * read the list still works and says devices were not checked.
 */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const LIMITS = {
  noOrdersWarnDays: 7,
  noOrdersCriticalDays: 30,
  walletLowPaise: 20000, // ₹200
  walletCriticalPaise: 5000, // ₹50
  renewalWindowDays: 7,
  deviceOfflineHours: 12,
  gstMultiplier: 1.18, // lastPaidPricePaise is before GST
};

const rupees = (paise) => `₹${Math.floor((paise || 0) / 100).toLocaleString("en-IN")}`;
const IST = { timeZone: "Asia/Kolkata" };
const dateIST = (d) => new Date(d).toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short" });
const dateTimeIST = (d) => new Date(d).toLocaleString("en-IN", { ...IST, day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/** Devices by POS store id, from KKMDM. Null when KKMDM cannot be read. */
const readDevices = async (storeIds) => {
  try {
    const db = mongoose.connection.useDb(process.env.KKMDM_DB_NAME || "kkmdm", { useCache: true });
    const stores = await db.collection("stores").find({ kkStoreId: { $in: storeIds } }, { projection: { kkStoreId: 1 } }).toArray();
    if (!stores.length) return new Map();
    const byMdmId = new Map(stores.map((s) => [String(s._id), s.kkStoreId]));
    const devices = await db.collection("devices")
      .find({ storeId: { $in: stores.map((s) => s._id) }, lifecycle: { $in: ["enrolled", "active"] } }, { projection: { storeId: 1, name: 1, online: 1, lastSeenAt: 1 } })
      .toArray();
    const out = new Map();
    for (const d of devices) {
      const id = byMdmId.get(String(d.storeId));
      if (!out.has(id)) out.set(id, []);
      out.get(id).push(d);
    }
    return out;
  } catch (err) {
    console.warn("[health] devices could not be read:", err.message); // eslint-disable-line no-console
    return null;
  }
};

/** The problems with one store. Pure, so the rules can be tested on their own. */
const issuesFor = ({ store, lastOrderAt, balancePaise, sub, devices, exempt = false, now = new Date() }) => {
  const issues = [];
  const add = (kind, severity, title, detail, extra = {}) => issues.push({ kind, severity, title, detail, ...extra });

  // Orders. A store younger than the window has had no chance to be quiet yet.
  const ageDays = (now - new Date(store.createdAt || now)) / DAY;
  if (lastOrderAt) {
    const days = Math.floor((now - new Date(lastOrderAt)) / DAY);
    if (days >= LIMITS.noOrdersWarnDays) {
      add("no_orders", days >= LIMITS.noOrdersCriticalDays ? "critical" : "warning", `No orders in ${days} days`, `Last order ${dateIST(lastOrderAt)}`);
    }
  } else if (ageDays >= LIMITS.noOrdersWarnDays) {
    add("no_orders", ageDays >= LIMITS.noOrdersCriticalDays ? "critical" : "warning", "No orders yet", `Onboarded ${Math.floor(ageDays)} days ago`);
  }

  // Wallet. Only for a store that is billed: a demo store never is, and a store
  // that has not started a plan yet has nothing that could stop working.
  const balance = balancePaise || 0;
  const billed = !exempt && ["ACTIVE", "EXPIRED"].includes(sub?.status);
  if (billed && balance < LIMITS.walletLowPaise) {
    add("wallet_low", balance < LIMITS.walletCriticalPaise ? "critical" : "warning", "Wallet nearly empty", `${rupees(balance)} left`, { balancePaise: balance });
  }

  // Subscription. A plan that will renew from the wallet is not a problem.
  if (exempt) {
    // A demo store's plan is never charged.
  } else if (sub?.status === "EXPIRED") {
    add("subscription_ending", "critical", "Subscription expired", sub.currentPeriodEnd ? `Ended ${dateIST(sub.currentPeriodEnd)}` : "Renewal failed", { endsAt: sub.currentPeriodEnd });
  } else if (sub?.status === "ACTIVE" && sub.currentPeriodEnd) {
    const days = (new Date(sub.currentPeriodEnd) - now) / DAY;
    const needs = Math.ceil((sub.lastPaidPricePaise || 0) * LIMITS.gstMultiplier);
    if (days <= LIMITS.renewalWindowDays && balance < needs) {
      add("subscription_ending", days <= 2 ? "critical" : "warning", "Renewal will fail", `Ends ${dateIST(sub.currentPeriodEnd)}; needs about ${rupees(needs)}, wallet has ${rupees(balance)}`, { endsAt: sub.currentPeriodEnd });
    }
  }

  // Devices.
  const stale = (devices || []).filter((d) => !d.online && (!d.lastSeenAt || now - new Date(d.lastSeenAt) >= LIMITS.deviceOfflineHours * HOUR));
  if (stale.length) {
    const oldest = stale.reduce((a, b) => (new Date(a.lastSeenAt || 0) < new Date(b.lastSeenAt || 0) ? a : b));
    const all = stale.length === devices.length;
    add(
      "device_offline",
      all ? "critical" : "warning",
      stale.length === 1 ? "Tablet offline" : `${stale.length} tablets offline`,
      oldest.lastSeenAt ? `${oldest.name || "Tablet"} last seen ${dateTimeIST(oldest.lastSeenAt)}` : `${oldest.name || "Tablet"} has never connected`,
      { deviceName: oldest.name || "Tablet", lastSeenAt: oldest.lastSeenAt || null }
    );
  }
  return issues;
};

/** Every active store with at least one issue, worst first, plus totals. */
const computeHealth = async (now = new Date()) => {
  const stores = await Store.find(
    { isDeleted: { $ne: true }, status: "active" },
    { storeId: 1, storeName: 1, ownerName: 1, ownerPhone: 1, restaurantId: 1, createdAt: 1 }
  ).lean();
  const restaurantIds = stores.map((s) => s.restaurantId).filter(Boolean);

  const [lastOrders, balances, subs, devices, exemptRows] = await Promise.all([
    Order.aggregate([
      { $match: { restaurantId: { $in: restaurantIds } } },
      { $sort: { restaurantId: 1, createdAt: -1 } },
      { $group: { _id: "$restaurantId", last: { $first: "$createdAt" } } },
    ]),
    BusinessBalance.find({ restaurantId: { $in: restaurantIds } }, { restaurantId: 1, balancePaise: 1 }).lean(),
    PlatformSubscription.find({ restaurantId: { $in: restaurantIds } }, { restaurantId: 1, status: 1, currentPeriodEnd: 1, lastPaidPricePaise: 1, planName: 1 }).lean(),
    readDevices(stores.map((s) => s.storeId)),
    CsdStoreCharges.find({ storeId: { $in: stores.map((s) => s.storeId) }, billingExempt: true }, { storeId: 1 }).lean(),
  ]);
  const exemptIds = new Set(exemptRows.map((r) => r.storeId));
  const byId = (rows, pick) => new Map(rows.map((r) => [String(r.restaurantId ?? r._id), pick(r)]));
  const orderAt = byId(lastOrders, (r) => r.last);
  const balance = byId(balances, (r) => r.balancePaise);
  const sub = byId(subs, (r) => r);

  const rows = [];
  for (const store of stores) {
    const rid = String(store.restaurantId || "");
    const issues = issuesFor({
      store,
      lastOrderAt: orderAt.get(rid) || null,
      balancePaise: balance.get(rid) || 0,
      sub: sub.get(rid) || null,
      devices: devices?.get(store.storeId) || [],
      exempt: exemptIds.has(store.storeId),
      now,
    });
    if (!issues.length) continue;
    rows.push({
      storeId: store.storeId,
      storeName: store.storeName,
      ownerName: store.ownerName,
      ownerPhone: store.ownerPhone,
      lastOrderAt: orderAt.get(rid) || null,
      balancePaise: balance.get(rid) || 0,
      plan: sub.get(rid)?.planName || "",
      issues,
      critical: issues.filter((i) => i.severity === "critical").length,
    });
  }
  rows.sort((a, b) => b.critical - a.critical || b.issues.length - a.issues.length || a.storeName.localeCompare(b.storeName));

  const counts = { no_orders: 0, wallet_low: 0, subscription_ending: 0, device_offline: 0 };
  for (const r of rows) for (const i of r.issues) counts[i.kind] += 1;
  return { rows, counts, activeStores: stores.length, devicesChecked: devices !== null, limits: LIMITS };
};

module.exports = { computeHealth, issuesFor, readDevices, LIMITS, rupees, dateIST, dateTimeIST };
