const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const { resolveTenantFromUser } = require("../services/tenantContext");
const { emitOrderStatusChanged } = require("../services/socket");
const { isFinished, AWAITING_ACCEPTANCE } = require("../constants/orderStatus");
const { computeReadyDueAt, computeCompleteDueAt } = require("../services/autoReadyService");

/**
 * POS-side online order management (§14).
 *
 * Reuses the EXISTING order lifecycle vocabulary rather than inventing a
 * parallel status system: the POS already uses "Pending" / "In Progress" /
 * "Ready" / "Completed" / "Cancelled" strings on Order.orderStatus, and the
 * KDS reads the same field. We only add the accept/reject semantics on top.
 */

// Maps the UI actions in §14 onto the statuses the POS already understands.
const ACTION_STATUS = {
  accept: "In Progress",
  preparing: "In Progress",
  ready: "Ready",
  completed: "Completed",
  cancel: "Cancelled",
  reject: "Cancelled",
};

/** Every query is constrained to the caller's own restaurant. */
const tenantScope = async (req) => {
  const tenant = await resolveTenantFromUser(req.user);
  if (!tenant.restaurantId && !tenant.storeId) return null;

  const scope = { isDeleted: { $ne: true } };
  if (tenant.restaurantId) scope.restaurantId = tenant.restaurantId;
  else scope.storeId = tenant.storeId;
  return { tenant, scope };
};

const toPosOrderView = (order) => ({
  _id: order._id,
  orderNumber: order.orderNumber,
  source: order.source,
  storeId: order.storeId,
  orderType: order.orderType,
  // Deliberately NOT canonicalised. canonicalStatus folds "Pending" and
  // "In Progress" into "Preparing", but this view drives the Accept / Reject
  // buttons, and those two states are what tell staff whether an order still
  // needs accepting. Folding them would collapse the distinction and leave
  // the card with no actions at all.
  orderStatus: order.orderStatus,
  scheduledFor: order.scheduledFor,
  customerDetails: order.customerDetails,
  deliveryAddress: order.deliveryAddress,
  items: (order.items || []).map((i) => ({
    name: i.name,
    quantity: i.quantity,
    unitPrice: i.unitPrice || i.price,
    total: i.total,
    variant: i.variant?.name || "",
    addons: (i.addons || []).map((a) => ({ name: a.name, price: a.price })),
    options: (i.modifierSelections || []).map((m) => ({
      group: m.groupName,
      name: m.optionName,
      price: m.price,
    })),
    note: i.note || "",
    imageUrl: i.imageUrl || "",
    status: i.status,
  })),
  bills: order.bills,
  payments: order.payments,
  paymentStatus: order.payments?.[0]?.status || "pending",
  timeline: order.timeline,
  createdAt: order.createdAt,
});

/**
 * GET /api/online-orders
 * The POS's reconciliation endpoint: after a dropped socket connection the
 * client calls this to pick up anything it missed (§32).
 */
const listOnlineOrders = async (req, res, next) => {
  try {
    const scoped = await tenantScope(req);
    if (!scoped) return res.status(200).json({ success: true, data: [] });

    const filter = { ...scoped.scope, source: "WEBSITE" };

    if (req.query.status) {
      const statuses = String(req.query.status).split(",").map((s) => s.trim()).filter(Boolean);
      if (statuses.length) filter.orderStatus = { $in: statuses };
    }
    // "since" lets a reconnecting client fetch only new orders.
    if (req.query.since) {
      const since = new Date(req.query.since);
      if (!Number.isNaN(since.getTime())) filter.createdAt = { $gt: since };
    }

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(limit);

    res.status(200).json({ success: true, data: orders.map(toPosOrderView) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/online-orders/:id */
const getOnlineOrder = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return next(createHttpError(404, "Order not found."));
    }
    const scoped = await tenantScope(req);
    if (!scoped) return next(createHttpError(404, "Order not found."));

    const order = await Order.findOne({ _id: req.params.id, ...scoped.scope });
    // Cross-tenant reads return the same 404 as a genuinely missing order.
    if (!order) return next(createHttpError(404, "Order not found."));

    res.status(200).json({ success: true, data: toPosOrderView(order) });
  } catch (error) {
    next(error);
  }
};

/** PUT /api/online-orders/:id/status — accept / reject / progress an order. */
const updateOnlineOrderStatus = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return next(createHttpError(404, "Order not found."));
    }

    const scoped = await tenantScope(req);
    if (!scoped) return next(createHttpError(404, "Order not found."));

    const action = String(req.body?.action || "").toLowerCase();
    const nextStatus = ACTION_STATUS[action];
    if (!nextStatus) {
      return next(
        createHttpError(400, `Invalid action. Expected one of: ${Object.keys(ACTION_STATUS).join(", ")}.`)
      );
    }

    const order = await Order.findOne({ _id: req.params.id, ...scoped.scope });
    if (!order) return next(createHttpError(404, "Order not found."));

    // Was ["Completed", "Cancelled"] — an exact-match pair that missed
    // "Served"/"Delivered" (written by the auto-complete sweep), "paid"
    // (a settled table bill) and every legacy lowercase spelling, so a
    // finished order could be transitioned again.
    if (isFinished(order.orderStatus)) {
      return next(createHttpError(409, `This order is already ${order.orderStatus.toLowerCase()}.`));
    }

    order.orderStatus = nextStatus;

    // The auto-ready / auto-complete clocks start on ACCEPTANCE, not at
    // creation. A website order sits in "Pending" until a human takes it, and
    // an order nobody has accepted must never promote itself to Ready and text
    // the customer that food is waiting. Scheduled pre-orders keep skipping
    // auto-ready — their deadline belongs to scheduledFor, not to now.
    if ((action === "accept" || action === "preparing") && !order.readyDueAt && !order.scheduledFor) {
      const clockArgs = {
        restaurantId: order.restaurantId,
        storeId: order.storeId,
        orderType: order.orderType,
      };
      order.readyDueAt = await computeReadyDueAt(clockArgs);
      order.completeDueAt = await computeCompleteDueAt(clockArgs);
    }

    order.timeline.push({
      status: nextStatus,
      timestamp: new Date(),
      user: req.user?.name || "POS",
    });

    if (action === "reject" || action === "cancel") {
      const reason = String(req.body?.reason || "").slice(0, 300);
      order.items.forEach((item) => {
        item.status = "cancelled";
        item.cancelledAt = new Date();
        if (reason) item.cancelReason = reason;
      });
    }

    await order.save();

    // Push the change to any listening client (customer tracking, KDS).
    try {
      emitOrderStatusChanged({
        restaurantId: order.restaurantId,
        outletId: order.outletId,
        storeId: order.storeId,
        order,
      });
    } catch (err) {
      console.warn("Realtime status emit failed:", err.message);
    }

    res.status(200).json({ success: true, message: `Order ${action}ed`, data: toPosOrderView(order) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/online-orders/stats/summary — lightweight analytics (§28). */
const getOnlineOrderStats = async (req, res, next) => {
  try {
    const scoped = await tenantScope(req);
    if (!scoped) return res.status(200).json({ success: true, data: {} });

    const since = new Date();
    since.setHours(0, 0, 0, 0);

    const [summary] = await Order.aggregate([
      { $match: { ...scoped.scope, source: "WEBSITE", createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: { $sum: "$bills.totalWithTax" },
          pending: { $sum: { $cond: [{ $eq: ["$orderStatus", AWAITING_ACCEPTANCE] }, 1, 0] } },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        ordersToday: summary?.orders || 0,
        revenueToday: Math.round((summary?.revenue || 0) * 100) / 100,
        pendingOrders: summary?.pending || 0,
        averageOrderValue: summary?.orders ? Math.round((summary.revenue / summary.orders) * 100) / 100 : 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/online-orders/:id/items  { action: "accept" | "reject" }
 *
 * Resolves the items a diner added to a table that was already mid-meal.
 * Those arrive on the EXISTING order as status "pending" (see qrRoute), so
 * the till reviews just the additions rather than the whole ticket.
 *
 *   accept -> the pending items join the ticket as "preparing"
 *   reject -> they are removed and the bill drops back
 *
 * Either way the order itself is untouched: additions must never spawn a
 * second order for one table.
 */
const resolveAddedItems = async (req, res, next) => {
  try {
    const action = String(req.body?.action || "").toLowerCase();
    if (!["accept", "reject"].includes(action)) {
      return next(createHttpError(400, "action must be accept or reject."));
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return next(createHttpError(404, "Invalid order id."));
    }

    // tenantScope returns { tenant, scope } - spreading the WRAPPER put
    // literal "tenant"/"scope" keys into the filter, so the lookup matched
    // nothing and every request 404'd.
    const scoped = await tenantScope(req);
    if (!scoped) return next(createHttpError(400, "Your account is not linked to a store yet."));

    const order = await Order.findOne({ _id: req.params.id, ...scoped.scope });
    if (!order) return next(createHttpError(404, "Order not found."));

    const pending = (order.items || []).filter((i) => i.status === "pending");
    if (pending.length === 0) {
      return next(createHttpError(409, "This order has no items waiting to be reviewed."));
    }

    if (action === "accept") {
      pending.forEach((i) => { i.status = "preparing"; });
    } else {
      order.items = (order.items || []).filter((i) => i.status !== "pending");
    }

    // Keep the ticket total honest after either outcome.
    const subtotal = (order.items || []).reduce((s, i) => s + (Number(i.total) || 0), 0);
    if (order.bills) {
      const taxRate = Number(order.bills.subtotal) > 0
        ? Number(order.bills.tax || 0) / Number(order.bills.subtotal)
        : 0;
      order.bills.subtotal = subtotal;
      order.bills.tax = Math.round(subtotal * taxRate * 100) / 100;
      order.bills.totalWithTax =
        Math.round((subtotal + order.bills.tax + Number(order.bills.charges || 0)) * 100) / 100;
    }

    await order.save();

    try {
      emitOrderStatusChanged({
        restaurantId: order.restaurantId,
        outletId: order.outletId,
        order,
      });
    } catch (e) {
      console.warn("[onlineOrder] added-items emit failed:", e.message);
    }

    res.status(200).json({
      success: true,
      message:
        action === "accept"
          ? `${pending.length} added item(s) accepted.`
          : `${pending.length} added item(s) removed.`,
      data: toPosOrderView(order),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  resolveAddedItems,
  listOnlineOrders,
  getOnlineOrder,
  updateOnlineOrderStatus,
  getOnlineOrderStats,
  toPosOrderView,
  ACTION_STATUS,
};
