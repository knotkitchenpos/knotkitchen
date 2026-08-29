const createHttpError = require("http-errors");
const KDSOrder = require("../models/kdsModel");
const Order = require("../models/orderModel");
const AuditLog = require("../models/auditLogModel");
const { PREPARING, READY, COMPLETED } = require("../constants/orderStatus");

// ===== Create KDS Order from order =====
const createKDSOrder = async (req, res, next) => {
  try {
    const { orderId, station = "Main Kitchen", priority = "normal" } = req.body;
    if (!orderId) {
      const error = createHttpError(400, "Order ID is required!");
      return next(error);
    }

    const order = await Order.findById(orderId);
    if (!order) {
      const error = createHttpError(404, "Order not found!");
      return next(error);
    }

    // Convert order items to KDS items
    const kdsItems = (order.items || []).map((item) => ({
      name: item.name || item.menuItemName || "Item",
      quantity: item.quantity || 1,
      notes: item.note || "",
      modifiers: item.modifiers || [],
      status: "queued",
    }));

    const kdsOrder = await KDSOrder.create({
      restaurantId: req.user.restaurantId || order.restaurantId || null,
      outletId: req.user.outletId || null,
      orderId,
      station,
      items: kdsItems,
      priority,
      status: "queued",
      receivedAt: new Date(),
    });

    // Update order status to "In Progress"
    await Order.findByIdAndUpdate(orderId, { orderStatus: PREPARING });

    res.status(201).json({ success: true, message: "Order sent to kitchen!", data: kdsOrder });
  } catch (error) {
    next(error);
  }
};

// ===== Get KDS Orders =====
const getKDSOrders = async (req, res, next) => {
  try {
    const { status, station } = req.query;
    const query = { isDeleted: false };

    if (req.user.restaurantId) query.restaurantId = req.user.restaurantId;
    if (status) query.status = status;
    if (station) query.station = station;

    const orders = await KDSOrder.find(query)
      .sort({ priority: -1, receivedAt: 1 })
      .limit(50);

    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    next(error);
  }
};

// ===== Update Item Status =====
const updateItemStatus = async (req, res, next) => {
  try {
    const { kdsOrderId, itemId } = req.params;
    const { status, chefId } = req.body;

    const kdsOrder = await KDSOrder.findById(kdsOrderId);
    if (!kdsOrder) {
      const error = createHttpError(404, "KDS Order not found!");
      return next(error);
    }

    const item = kdsOrder.items.id(itemId);
    if (!item) {
      const error = createHttpError(404, "Item not found!");
      return next(error);
    }

    item.status = status;
    if (status === "preparing" && !item.startedAt) {
      item.startedAt = new Date();
      item.chefId = chefId || req.user._id;
    }
    if (status === "ready" || status === "served") {
      item.completedAt = new Date();
      if (item.startedAt) {
        item.timeTakenSec = Math.round((item.completedAt - item.startedAt) / 1000);
      }
    }

    await kdsOrder.save();

    // Update parent KDS order status
    if (item.status === "ready" && kdsOrder.status === "preparing") {
      const allReady = kdsOrder.items.every((i) => i.status === "ready" || i.status === "served");
      if (allReady) {
        kdsOrder.status = "ready";
        kdsOrder.completedAt = new Date();
        await kdsOrder.save();
      }
    }

    // Update order status when ready
    if (item.status === "ready") {
      await Order.findByIdAndUpdate(kdsOrder.orderId, { orderStatus: READY });
    }

    res.status(200).json({ success: true, message: "Item status updated!", data: kdsOrder });
  } catch (error) {
    next(error);
  }
};

// ===== Update KDS Order Status =====
const updateKDSStatus = async (req, res, next) => {
  try {
    const { kdsOrderId } = req.params;
    const { status } = req.body;

    const kdsOrder = await KDSOrder.findById(kdsOrderId);
    if (!kdsOrder) {
      const error = createHttpError(404, "KDS Order not found!");
      return next(error);
    }

    kdsOrder.status = status;
    if (status === "preparing" && !kdsOrder.startedAt) {
      kdsOrder.startedAt = new Date();
    }
    if (status === "completed" || status === "ready" || status === "served") {
      kdsOrder.completedAt = new Date();
      // Set all items to matching status if not already set
      kdsOrder.items.forEach((item) => {
        if (item.status === "queued" || item.status === "preparing") {
          item.status = status === "served" ? "served" : "ready";
          item.completedAt = new Date();
        }
      });
    }

    await kdsOrder.save();

    if (status === "ready") {
      await Order.findByIdAndUpdate(kdsOrder.orderId, { orderStatus: READY });
    } else if (status === "served") {
      await Order.findByIdAndUpdate(kdsOrder.orderId, { orderStatus: COMPLETED });
    }

    res.status(200).json({ success: true, message: "Order status updated!", data: kdsOrder });
  } catch (error) {
    next(error);
  }
};

// ===== KDS Analytics =====
const getKDSAnalytics = async (req, res, next) => {
  try {
    const { restaurantId, range = "today" } = req.query;

    const startDate = new Date();
    if (range === "today") startDate.setHours(0, 0, 0, 0);
    else if (range === "week") startDate.setDate(startDate.getDate() - 7);
    else if (range === "month") startDate.setMonth(startDate.getMonth() - 1);

    const query = {
      isDeleted: false,
      createdAt: { $gte: startDate },
    };
    if (restaurantId) query.restaurantId = restaurantId;

    const orders = await KDSOrder.find(query);

    // Metrics
    const totalOrders = orders.length;
    const completedOrders = orders.filter((o) => o.status === "completed" || o.status === "served").length;
    const inProgress = orders.filter((o) => o.status === "preparing" || o.status === "queued").length;

    // Average prep time
    const prepTimes = orders
      .flatMap((o) => o.items)
      .map((i) => i.timeTakenSec)
      .filter(Boolean);
    const avgPrepTime = prepTimes.length
      ? Math.round(prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length)
      : 0;

    // Chef performance
    const chefPerformance = {};
    orders.forEach((o) => {
      o.items.forEach((item) => {
        if (item.chefId && item.timeTakenSec) {
          const key = item.chefId.toString();
          if (!chefPerformance[key]) {
            chefPerformance[key] = { chefId: key, orderCount: 0, totalTimeSec: 0 };
          }
          chefPerformance[key].orderCount++;
          chefPerformance[key].totalTimeSec += item.timeTakenSec;
        }
      });
    });

    const chefStats = Object.values(chefPerformance).map((c) => ({
      ...c,
      avgTimeSec: Math.round(c.totalTimeSec / c.orderCount),
    }));

    res.status(200).json({
      success: true,
      data: {
        totalOrders,
        completedOrders,
        inProgress,
        avgPrepTimeSec: avgPrepTime,
        chefStats,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createKDSOrder,
  getKDSOrders,
  updateItemStatus,
  updateKDSStatus,
  getKDSAnalytics,
};