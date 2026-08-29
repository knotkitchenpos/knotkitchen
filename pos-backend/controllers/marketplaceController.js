const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const Order = require("../models/orderModel");
// Marketplace orders arrive needing acceptance, like website orders.
const { AWAITING_ACCEPTANCE } = require("../constants/orderStatus");

// Store active SSE client connections
const sseClients = new Set();

const broadcastNewOrder = (order) => {
  const payload = JSON.stringify({ type: "NEW_MARKETPLACE_ORDER", order });
  sseClients.forEach((client) => {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (err) {
      sseClients.delete(client);
      client.end();
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
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
  } catch (error) {
    next(error);
  }
};

const webhookMarketplaceOrder = async (req, res, next) => {
  try {
    const { order } = req.body;
    if (!order) {
      const error = createHttpError(400, "Order payload is required!");
      return next(error);
    }
    const newOrder = new Order(order);
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
    const order = new Order({ ...req.body, createdBy: req.user._id });
    order.marketplace = req.body.marketplace || "Manual";
    order.orderStatus = req.body.orderStatus || AWAITING_ACCEPTANCE;
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
    const order = await Order.findByIdAndUpdate(
      { _id: id, createdBy: req.user._id },
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
