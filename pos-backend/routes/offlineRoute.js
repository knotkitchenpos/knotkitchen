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
        const placedAt = new Date(entry.placedAt);
        const sane = !Number.isNaN(placedAt.getTime()) && Date.now() - placedAt.getTime() < 7 * 86400000 && placedAt.getTime() <= Date.now();
        await Order.updateOne(
          { _id: created._id },
          { $set: { isOffline: true, syncStatus: "synced", ...(sane ? { createdAt: placedAt, orderDate: placedAt } : {}) } },
        );
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
