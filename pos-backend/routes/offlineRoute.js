const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const Order = require("../models/orderModel");
const { addOrder } = require("../controllers/orderController");
const { findOrCreate } = require("../services/idempotency");

const router = express.Router();

/**
 * POST /api/offline/orders/sync  { orders: [{ localId, placedAt, order }] }
 *
 * Orders the till took while the internet was down. Each one goes through
 * the SAME addOrder as a live order (allow-list, pricing, customer upsert,
 * sockets), carrying the offline key from birth so a retry cannot create it
 * twice, and is back-dated to when it was actually taken.
 */
router.route("/orders/sync").post(isVerifiedUser, async (req, res, next) => {
  try {
    const list = Array.isArray(req.body?.orders) ? req.body.orders.slice(0, 200) : [];
    if (!list.length) return res.status(400).json({ success: false, message: "Orders array required!" });
    if (!req.user?.restaurantId) return res.status(400).json({ success: false, message: "No restaurant on this account." });

    const synced = [];
    const failed = [];
    for (const entry of list) {
      const localId = String(entry?.localId || "").trim().slice(0, 80);
      if (!localId || !entry?.order || typeof entry.order !== "object") {
        failed.push({ localId, error: "localId and order are required" });
        continue;
      }
      const key = `offline:${localId}`;
      try {
        const { doc: created, duplicate } = await findOrCreate({
          find: () => Order.findOne({ restaurantId: req.user.restaurantId, idempotencyKey: key }).select("_id orderNumber").lean(),
          create: () => runAddOrder(req, entry.order, key),
        });
        if (duplicate) {
          synced.push({ localId, serverId: created._id, orderNumber: created.orderNumber, duplicate: true });
          continue;
        }
        await Order.collection.updateOne({ _id: created._id }, { $set: backdate(created, entry.placedAt) });
        synced.push({ localId, serverId: created._id, orderNumber: created.orderNumber });
      } catch (err) {
        failed.push({ localId, error: err.message || "failed" });
      }
    }
    res.status(200).json({ success: true, data: { syncedOrders: synced, failedOrders: failed } });
  } catch (error) {
    next(error);
  }
});

/**
 * The sale happened when the till took it, not when it synced. Reports, the
 * Orders day filter and the order's age all read createdAt, so a sale rung up
 * at 23:55 and synced next morning belonged to the wrong day. Mongoose treats
 * createdAt as immutable and silently dropped it from updateOne, so this is
 * written straight to the collection. The auto-ready and auto-complete clocks
 * and the timeline move back by the same amount: food handed over an hour ago
 * is not "Preparing" for another 20 minutes.
 */
const backdate = (created, placedAtRaw) => {
  const set = { isOffline: true, syncStatus: "synced" };
  const placedAt = new Date(placedAtRaw);
  const createdAt = new Date(created.createdAt || Date.now());
  const sane = !Number.isNaN(placedAt.getTime()) && Date.now() - placedAt.getTime() < 7 * 86400000 && placedAt.getTime() <= Date.now();
  if (!sane) return set;
  const shift = createdAt.getTime() - placedAt.getTime();
  set.createdAt = placedAt;
  set.orderDate = placedAt;
  for (const f of ["readyDueAt", "completeDueAt"]) if (created[f]) set[f] = new Date(new Date(created[f]).getTime() - shift);
  (created.timeline || []).forEach((t, i) => {
    if (t?.timestamp) set[`timeline.${i}.timestamp`] = new Date(new Date(t.timestamp).getTime() - shift);
  });
  return set;
};

/** Run the live addOrder against one queued order, capturing its result. */
const runAddOrder = (req, body, idempotencyKey) =>
  new Promise((resolve, reject) => {
    const fakeReq = Object.create(req);
    fakeReq.body = body;
    fakeReq.idempotencyKey = idempotencyKey;
    const fakeRes = {
      status() {
        return this;
      },
      json(payload) {
        if (payload?.success && payload.data) resolve(payload.data);
        else reject(new Error(payload?.message || "Order was not created"));
      },
    };
    addOrder(fakeReq, fakeRes, (err) => reject(err || new Error("Order was not created")));
  });

module.exports = router;
module.exports.backdate = backdate;
