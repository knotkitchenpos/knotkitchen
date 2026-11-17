/**
 * Loyalty points (owner, 2026-11-17).
 *
 * Per store (Restaurant.loyalty, off until the owner switches it on): points
 * per ₹100 paid, ₹ off per point, points needed to redeem, and months of no
 * activity after which a balance expires (0 = never).
 *
 *   earn     on every paid bill with a customer phone: counter orders and
 *            table bills, at the same moments the auto e-bill fires.
 *   redeem   at counter checkout, as a fixed discount the server checks
 *            (orderController.addOrder): balance, minimum, the discount
 *            covering it.
 *   cancel   a cancelled order takes back what it earned and gives back
 *            what it redeemed.
 *
 * The balance is on the customer (loyaltyPoints); every change is a
 * LoyaltyEntry with a unique key, so each happens once however often a
 * payment callback or retry repeats it. Nothing here may fail a sale:
 * earning and reversing never throw.
 */

const LoyaltyEntry = require("../models/loyaltyEntryModel");

const settingsOf = (restaurant) => {
  const l = restaurant?.loyalty || {};
  return {
    enabled: Boolean(l.enabled),
    earnPer100: Number.isFinite(Number(l.earnPer100)) ? Number(l.earnPer100) : 1,
    pointValue: Number(l.pointValue) > 0 ? Number(l.pointValue) : 1,
    minRedeem: Number.isFinite(Number(l.minRedeem)) ? Number(l.minRedeem) : 50,
    expiryMonths: Number.isFinite(Number(l.expiryMonths)) ? Number(l.expiryMonths) : 12,
  };
};

/** Points a paid bill earns: whole points only, never negative. */
const pointsFor = (billAmount, settings) => Math.max(0, Math.floor(((Number(billAmount) || 0) / 100) * settings.earnPer100));

const round2 = (n) => Math.round(n * 100) / 100;

/** Has this balance expired (no activity for expiryMonths)? */
const isExpired = (customer, settings, now = new Date()) => {
  if (!settings.expiryMonths || !customer?.loyaltyLastAt || !(customer.loyaltyPoints > 0)) return false;
  const until = new Date(customer.loyaltyLastAt);
  until.setMonth(until.getMonth() + settings.expiryMonths);
  return now >= until;
};

/** Apply one change once (by key). Returns true when it happened now. */
const move = async ({ customer, restaurantId, kind, points, key, orderId = null, tableSessionId = null, billAmount = 0, now = new Date() }) => {
  const Customer = require("../models/customerModel");
  try {
    await LoyaltyEntry.create({ restaurantId, customerId: customer._id, kind, points, key, orderId, tableSessionId, billAmount });
  } catch (err) {
    if (err?.code === 11000) return false; // already done
    throw err;
  }
  // Never below zero (a reversal after the points were spent takes what is left).
  await Customer.updateOne({ _id: customer._id }, [
    { $set: { loyaltyPoints: { $max: [0, { $add: [{ $ifNull: ["$loyaltyPoints", 0] }, points] }] }, loyaltyLastAt: now } },
  ]);
  return true;
};

/** Expire a stale balance first, so it is never earned on or spent. */
const expireIfDue = async (customer, settings, restaurantId, now = new Date()) => {
  if (!isExpired(customer, settings, now)) return customer;
  await move({ customer, restaurantId, kind: "EXPIRE", points: -customer.loyaltyPoints, key: `expire:${customer._id}:${now.toISOString().slice(0, 10)}`, now });
  return { ...customer, loyaltyPoints: 0 };
};

const findCustomer = async (restaurantId, phone) => {
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  if (!/^\d{10}$/.test(digits)) return null;
  const Customer = require("../models/customerModel");
  return Customer.findOne({ restaurantId, phone: digits, isDeleted: { $ne: true } }).lean();
};

const loadSettings = async (restaurantId) => {
  const Restaurant = require("../models/restaurantModel");
  const r = await Restaurant.findById(restaurantId).select("loyalty name").lean();
  return { settings: settingsOf(r), name: r?.name || "" };
};

/** The balance the POS shows for a phone. */
const lookup = async (restaurantId, phone, now = new Date()) => {
  const { settings } = await loadSettings(restaurantId);
  if (!settings.enabled) return { enabled: false };
  let c = await findCustomer(restaurantId, phone);
  if (c) c = await expireIfDue(c, settings, restaurantId, now);
  const points = c?.loyaltyPoints || 0;
  return {
    enabled: true,
    points,
    value: round2(points * settings.pointValue),
    pointValue: settings.pointValue,
    minRedeem: settings.minRedeem,
    canRedeem: points > 0 && points >= settings.minRedeem,
  };
};

/** Tell the customer their balance on WhatsApp, once its template is approved. Fire and forget. */
const tellBalance = (customer, earned, settings, storeName) => {
  setImmediate(async () => {
    try {
      const Customer = require("../models/customerModel");
      const fresh = await Customer.findById(customer._id).select("loyaltyPoints phone name").lean();
      if (!fresh?.phone) return;
      await require("./waTemplates").sendTemplate({
        name: "kk_loyalty_balance",
        // {{1}} name, {{2}} earned, {{3}} restaurant, {{4}} balance, {{5}} worth
        values: [fresh.name || "there", String(earned), storeName || "us", String(fresh.loyaltyPoints), `₹${round2(fresh.loyaltyPoints * settings.pointValue)}`],
        phone: fresh.phone,
        actorName: "Loyalty points",
      });
    } catch (err) {
      console.warn("[loyalty] balance message failed:", err?.message);
    }
  });
};

/** Earn for a paid bill. `source` is { orderId } or { tableSessionId }. Never throws. */
const earn = async (source) => {
  try {
    let restaurantId;
    let phone;
    let billAmount;
    let key;
    if (source.orderId) {
      const Order = require("../models/orderModel");
      const o = await Order.findById(source.orderId).select("restaurantId customerDetails.phone bills.totalWithTax orderStatus tableSessionId").lean();
      // A table's orders earn once, on the table bill.
      if (!o || o.tableSessionId || /cancel/i.test(o.orderStatus || "")) return null;
      ({ restaurantId } = o);
      phone = o.customerDetails?.phone;
      billAmount = o.bills?.totalWithTax;
      key = `earn:${o._id}`;
    } else if (source.tableSessionId) {
      const TableSession = require("../models/tableSessionModel");
      const s = await TableSession.findById(source.tableSessionId).select("restaurantId customerPhone bills.totalWithTax").lean();
      if (!s) return null;
      ({ restaurantId } = s);
      phone = s.customerPhone;
      billAmount = s.bills?.totalWithTax;
      key = `earn-s:${s._id}`;
    } else return null;
    const { settings, name } = await loadSettings(restaurantId);
    if (!settings.enabled) return null;
    const points = pointsFor(billAmount, settings);
    if (!points) return null;
    let c = await findCustomer(restaurantId, phone);
    if (!c) return null;
    c = await expireIfDue(c, settings, restaurantId);
    const done = await move({ customer: c, restaurantId, kind: "EARN", points, key, orderId: source.orderId || null, tableSessionId: source.tableSessionId || null, billAmount });
    if (done) tellBalance(c, points, settings, name);
    return done ? points : null;
  } catch (err) {
    console.warn("[loyalty] earn failed:", err?.message);
    return null;
  }
};

/** Run earn after the caller has answered. */
const earnLater = (source) => setImmediate(() => earn(source));

class LoyaltyError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true;
  }
}

/**
 * Check a counter redemption before the order is created. Returns
 * { customer, points, value } or throws LoyaltyError. Deduct with `redeem`.
 */
const checkRedeem = async ({ restaurantId, phone, points, discount }) => {
  const want = Math.floor(Number(points) || 0);
  if (want <= 0) throw new LoyaltyError("Choose how many points to use.");
  const { settings } = await loadSettings(restaurantId);
  if (!settings.enabled) throw new LoyaltyError("Loyalty points are switched off for this store.");
  let c = await findCustomer(restaurantId, phone);
  if (!c) throw new LoyaltyError("No loyalty points on this phone number.");
  c = await expireIfDue(c, settings, restaurantId);
  if (want > (c.loyaltyPoints || 0)) throw new LoyaltyError(`Only ${c.loyaltyPoints || 0} points are available.`);
  if (want < settings.minRedeem) throw new LoyaltyError(`At least ${settings.minRedeem} points are needed to redeem.`);
  const value = round2(want * settings.pointValue);
  if (Number(discount) + 0.01 < value) throw new LoyaltyError("The discount on the bill does not match the points used.");
  return { customer: c, points: want, value };
};

/** Deduct points for an order (or a table bill, with its own key), atomically: never below zero, once per key. */
const redeem = async ({ restaurantId, customer, points, orderId = null, tableSessionId = null, key = `redeem:${orderId}` }) => {
  const Customer = require("../models/customerModel");
  const taken = await Customer.findOneAndUpdate(
    { _id: customer._id, loyaltyPoints: { $gte: points } },
    { $inc: { loyaltyPoints: -points }, $set: { loyaltyLastAt: new Date() } },
    { new: true },
  );
  if (!taken) throw new LoyaltyError("Those points were just used elsewhere. Check the balance again.");
  try {
    await LoyaltyEntry.create({ restaurantId, customerId: customer._id, kind: "REDEEM", points: -points, key, orderId, tableSessionId });
  } catch (err) {
    // Already recorded for this order: put the points back.
    await Customer.updateOne({ _id: customer._id }, { $inc: { loyaltyPoints: points } });
    if (err?.code !== 11000) throw err;
  }
};

/** Give points back when the order that used them did not go through. */
const undoRedeem = async ({ customer, points, orderId }) => {
  const Customer = require("../models/customerModel");
  await Customer.updateOne({ _id: customer._id }, { $inc: { loyaltyPoints: points } });
  await LoyaltyEntry.deleteOne({ key: `redeem:${orderId}` });
};

/**
 * A table bill's points given back (its discount changed or removed, the
 * table closed unpaid): every use on the session, each once. Clears the list;
 * the caller saves the session. Never throws.
 */
const returnForSession = async (session) => {
  const uses = session?.loyaltyRedeems || [];
  for (const u of uses) {
    try {
      await move({ customer: { _id: u.customerId }, restaurantId: session.restaurantId, kind: "RETURN", points: u.points, key: `return:${u.key}`, tableSessionId: session._id });
    } catch (err) {
      console.warn("[loyalty] return failed:", err?.message);
    }
  }
  if (uses.length) session.loyaltyRedeems = [];
  return uses.length;
};

/** A cancelled order: take back what it earned, give back what it redeemed. Never throws. */
const reverseForOrder = async (order) => {
  try {
    const entries = await LoyaltyEntry.find({ orderId: order._id, kind: { $in: ["EARN", "REDEEM"] } }).lean();
    for (const e of entries) {
      const customer = { _id: e.customerId };
      if (e.kind === "EARN") await move({ customer, restaurantId: e.restaurantId, kind: "REVERSE", points: -e.points, key: `reverse:${order._id}`, orderId: order._id });
      else await move({ customer, restaurantId: e.restaurantId, kind: "RETURN", points: -e.points, key: `return:${order._id}`, orderId: order._id });
    }
  } catch (err) {
    console.warn("[loyalty] reverse failed:", err?.message);
  }
};

module.exports = { settingsOf, pointsFor, isExpired, lookup, earn, earnLater, checkRedeem, redeem, undoRedeem, returnForSession, reverseForOrder, LoyaltyError };
