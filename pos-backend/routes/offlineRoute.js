const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const Order = require("../models/orderModel");
const router = express.Router();

// POST - Sync offline orders back to server
router.route("/orders/sync").post(isVerifiedUser, async (req, res, next) => {
  try {
    const { orders } = req.body;
    if (!orders || !orders.length) return res.status(400).json({ success: false, message: "Orders array required!" });

    const syncedOrders = [];
    const failedOrders = [];
    for (const offlineOrder of orders) {
      try {
        const order = await Order.create({
          ...offlineOrder,
          isOffline: true,
          syncStatus: "synced",
          restaurantId: offlineOrder.restaurantId || req.body.restaurantId,
          outletId: offlineOrder.outletId || req.body.outletId,
          createdBy: req.user._id,
        });
        syncedOrders.push({ localId: offlineOrder.localId|| order._id, serverId: order._id });
      } catch (err) {
        failedOrders.push({ localId: offlineOrder.localId, error: err.message });
      }
    }
    res.status(200).json({ success: true, data: { syncedOrders, failedOrders } });
  } catch (error) { next(error); }
});

// GET - Get orders pending sync (for offline queue reconciliation)
router.route("/orders/pending").get(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await Order.find({ createdBy: req.user._id, syncStatus: "pending", isOffline: true });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

// POST - Resolve sync conflict (client sends the winning version)
router.route("/orders/conflict").post(isVerifiedUser, async (req, res, next) => {
  try {
    const { orderId, clientOrderData } = req.body;
    if (!orderId || !clientOrderData) return res.status(400).json({ success: false, message: "orderId and clientOrderData required!" });
    const order = await Order.findByIdAndUpdate(orderId, clientOrderData, { new: true, runValidators: true });
    res.status(200).json({ success: true, data: order, message: "Conflict resolved with client version" });
  } catch (error) { next(error); }
});

module.exports = router;