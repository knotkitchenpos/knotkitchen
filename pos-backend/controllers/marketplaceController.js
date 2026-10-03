const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const crypto = require("crypto");
const Order = require("../models/orderModel");
const config = require("../config/config");
// Marketplace orders arrive needing acceptance, like website orders.
const { AWAITING_ACCEPTANCE } = require("../constants/orderStatus");

// Active SSE clients, each tagged with the restaurant it may hear about.
// A marketplace order is only ever announced to its own restaurant's tills.
const sseClients = new Set(); // { res, restaurantId }

const broadcastNewOrder = (order) => {
  const payload = JSON.stringify({ type: "NEW_MARKETPLACE_ORDER", order });
  const target = String(order.restaurantId || "");
  sseClients.forEach((client) => {
    if (!target || String(client.restaurantId || "") !== target) return;
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch (err) {
      sseClients.delete(client);
      client.res.end();
    }
  });
};

const streamNewOrders = async (req, res, next) => {
  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: "CONNECTED" })}\n\n`);
    const client = { res, restaurantId: req.user?.restaurantId || null };
    sseClients.add(client);
    req.on("close", () => sseClients.delete(client));
  } catch (error) {
    next(error);
  }
};

/** Constant-time check of the bridge's shared secret. */
const secretMatches = (given) => {
  const expected = String(config.marketplaceWebhookSecret || "");
  const got = String(given || "");
  if (!expected || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
};

const webhookMarketplaceOrder = async (req, res, next) => {
  try {
    // No secret configured = no bridge = nothing may push orders in.
    if (!config.marketplaceWebhookSecret) return next(createHttpError(503, "Marketplace webhook is not enabled."));
    if (!secretMatches(req.headers["x-marketplace-secret"])) return next(createHttpError(401, "Bad webhook secret."));

    const { order } = req.body;
    if (!order || !mongoose.Types.ObjectId.isValid(order.restaurantId)) {
      return next(createHttpError(400, "Order payload with restaurantId is required!"));
    }
    // KnotKitchen's platform fee is only ever quoted and stamped by this
    // server; a pushed order carries none.
    const { platformCharge, ...pushed } = order;
    const newOrder = new Order({ ...pushed, bills: { ...pushed.bills, platformFee: 0 } });
    newOrder.marketplace = order.marketplace || "Manual";
    newOrder.orderStatus = order.orderStatus || AWAITING_ACCEPTANCE;
    await newOrder.save();
    broadcastNewOrder(newOrder);
    res.status(201).json({ success: true, message: "Order received!", data: newOrder });
  } catch (error) {
    next(error);
  }
};

const manualMarketplaceOrder = async (req, res, next) => {
  try {
    // EXPLICIT ALLOW-LIST, like addOrder: a spread body could stamp its own
    // platform fee (credited back on cancel), table session, payments or
    // status. The order belongs to the caller's restaurant, whatever the body says.
    const body = req.body || {};
    const { platformFee, ...bills } = body.bills || {};
    const order = new Order({
      customerDetails: body.customerDetails,
      orderType: body.orderType,
      deliveryAddress: body.deliveryAddress,
      items: body.items,
      bills,
      marketplace: body.marketplace || "Manual",
      marketplaceOrderId: body.marketplaceOrderId,
      orderStatus: AWAITING_ACCEPTANCE,
      createdBy: req.user._id,
      restaurantId: req.user.restaurantId || null,
    });
    await order.save();
    broadcastNewOrder(order);
    res.status(201).json({ success: true, message: "Marketplace order added!", data: order });
  } catch (error) {
    next(error);
  }
};

const markOrderSeen = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }
    const order = await Order.findOneAndUpdate(
      { _id: id, restaurantId: req.user.restaurantId || null },
      { isNewOrder: false },
      { new: true }
    );
    if (!order) {
      const error = createHttpError(404, "Order not found!");
      return next(error);
    }
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

module.exports = { sseClients, broadcastNewOrder, streamNewOrders, webhookMarketplaceOrder, manualMarketplaceOrder, markOrderSeen };
