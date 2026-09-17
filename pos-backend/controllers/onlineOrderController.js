const createHttpError = require("http-errors");
const { round2 } = require("../services/money");
const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const { resolveTenantFromUser } = require("../services/tenantContext");
const { emitOrderStatusChanged, emitTableSessionUpdated, orderCreatedPayload } = require("../services/socket");
const {
  isFinished,
  AWAITING_ACCEPTANCE,
  PREPARING,
  CANCELLED,
  READY_STATUSES,
  SETTLED_STATUSES,
  CANCELLED_STATUSES,
  REFUNDED_STATUSES,
} = require("../constants/orderStatus");
const { clocksOnAccept, prepDuePayload } = require("../services/autoReadyService");
const { emitToRestaurant } = require("../services/socket");

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
  prepStartAt: order.prepStartAt,
  prepStartedAt: order.prepStartedAt,
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
    // A scheduled pickup is queued with a prepStartAt instead of starting
    // now; see clocksOnAccept.
    if ((action === "accept" || action === "preparing") && !order.readyDueAt) {
      const clocks = await clocksOnAccept(order);
      order.prepStartAt = clocks.prepStartAt;
      order.readyDueAt = clocks.readyDueAt;
      order.completeDueAt = clocks.completeDueAt;
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

    // Cancelling a table's order must free the table. Without this the Orders
    // screen said "Cancelled" while Manage Tables kept the table occupied.
    if (action === "reject" || action === "cancel") {
      try {
        const { releaseSessionForCancelledOrder } = require("./tableSessionController");
        await releaseSessionForCancelledOrder(order, req.user?.name || "POS");
      } catch (err) {
        console.warn("releaseSessionForCancelledOrder failed:", err.message);
      }
    }

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

/**
 * GET /api/online-orders/prep-due
 * Queued orders whose start time has come and nobody has started yet -- so a
 * till that reloads, or missed the socket event, still rings for them.
 */
const listPrepDueOrders = async (req, res, next) => {
  try {
    const scoped = await tenantScope(req);
    if (!scoped) return res.status(200).json({ success: true, data: [] });
    const orders = await Order.find({
      ...scoped.scope,
      prepAlertedAt: { $ne: null },
      prepStartedAt: null,
      isDeleted: { $ne: true },
      orderStatus: { $nin: [...READY_STATUSES, ...SETTLED_STATUSES, ...CANCELLED_STATUSES, ...REFUNDED_STATUSES] },
    })
      .sort({ prepStartAt: 1 })
      .limit(50);
    res.status(200).json({ success: true, data: orders.map(prepDuePayload) });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/online-orders/awaiting — customer orders nobody has decided on yet,
 * in the shape of the `onlineOrder:created` event.
 *
 * The "New order" card used to exist only as a live socket event. A till whose
 * socket was down at that moment -- a phone with its screen off, the app
 * switched away to something else -- never saw the order, while the other
 * till at the counter did. Every device now asks for this list on (re)connect.
 *
 * "Undecided" per channel: a website order is created Pending and Accept moves
 * it to In Progress; a QR table order is created Preparing (the kitchen starts
 * at once) and Accept likewise moves it to In Progress. Limited to the last
 * twelve hours so a stale order does not ring every till on every reload.
 */
const listAwaitingOrders = async (req, res, next) => {
  try {
    const scoped = await tenantScope(req);
    if (!scoped) return res.status(200).json({ success: true, data: [] });
    const orders = await Order.find({
      ...scoped.scope,
      createdAt: { $gte: new Date(Date.now() - 12 * 60 * 60 * 1000) },
      $or: [
        { source: "WEBSITE", orderStatus: AWAITING_ACCEPTANCE },
        { source: "QR", orderStatus: PREPARING },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(50)
      .populate("table", "tableNumber displayId tableName");
    res.status(200).json({ success: true, data: orders.map((o) => orderCreatedPayload(o, o.storeId)) });
  } catch (error) {
    next(error);
  }
};

/** POST /api/online-orders/:id/start-preparing — staff acknowledge the prep alert. */
const startPreparingOrder = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return next(createHttpError(404, "Order not found."));
    const scoped = await tenantScope(req);
    if (!scoped) return next(createHttpError(404, "Order not found."));
    const order = await Order.findOne({ _id: req.params.id, ...scoped.scope });
    if (!order) return next(createHttpError(404, "Order not found."));

    if (!order.prepStartedAt) {
      order.prepStartedAt = new Date();
      order.timeline.push({ status: "Start Preparing", timestamp: new Date(), user: req.user?.name || "POS" });
      await order.save();
    }

    try {
      emitToRestaurant(order.restaurantId, "order:prepStarted", { orderId: String(order._id) });
      emitOrderStatusChanged({ restaurantId: order.restaurantId, outletId: order.outletId, storeId: order.storeId, order });
    } catch (err) {
      console.warn("Realtime prepStarted emit failed:", err.message);
    }

    res.status(200).json({ success: true, message: "Preparation started.", data: toPosOrderView(order) });
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
/**
 * Push a decision taken on a kitchen order back onto the table session.
 *
 * The session is the record Manage Tables and the diner's own phone read, so
 * a decision that stops at the Order is invisible on both. Lines are matched
 * on `kdsItemId` -- the session's pointer at the order line -- and only then
 * by name, for sessions written before that link existed.
 *
 * Required at load time rather than at the top of the file: tableSession's
 * controller requires this one back, and the eager pair resolved to undefined
 * depending on which was loaded first.
 */
const syncSessionFromOrder = async (order, orderItems, action) => {
  if (!order.tableSessionId) return null;

  const TableSession = require("../models/tableSessionModel");
  const { recalculateSessionBill } = require("./tableSessionController");

  const session = await TableSession.findOne({
    _id: order.tableSessionId,
    isDeleted: { $ne: true },
  });
  if (!session) return null;

  // A settled bill is history -- never rewrite it.
  if (["PAID", "CLOSED"].includes(session.status)) return null;

  const ids = new Set(orderItems.map((i) => String(i._id)));
  const names = orderItems.map((i) => String(i.name));

  const matches = session.items.filter((si) => {
    if (si.status === "cancelled") return false;
    if (si.kdsItemId && ids.has(String(si.kdsItemId))) return true;
    // Only fall back to the name when this item has no link at all, so a
    // linked line is never matched twice.
    return !si.kdsItemId && names.includes(String(si.name));
  });

  if (matches.length === 0) return session;

  const at = new Date();
  matches.forEach((si) => {
    if (action === "accept") {
      si.status = "preparing";
    } else {
      si.status = "cancelled";
      si.cancelledAt = at;
      si.cancelReason = action === "cancel_order" ? "Order cancelled" : "Not accepted";
    }
  });

  // Drops cancelled lines from the total and saves.
  await recalculateSessionBill(session);
  return session;
};

/**
 * Which of an order's pending lines this decision applies to.
 *
 * `itemIds` lets the till pull one dish out of a batch instead of all of
 * them; omitting it means the whole batch, which is what the two-button
 * popup sent before there was any choice.
 */
const selectPendingItems = (order, itemIds) => {
  const pending = (order.items || []).filter((i) => i.status === "pending");
  if (!Array.isArray(itemIds) || itemIds.length === 0) return pending;
  const wanted = new Set(itemIds.map(String));
  return pending.filter((i) => wanted.has(String(i._id)));
};

const resolveAddedItems = async (req, res, next) => {
  try {
    const action = String(req.body?.action || "").toLowerCase();
    if (!["accept", "reject", "cancel_order"].includes(action)) {
      return next(createHttpError(400, "action must be accept, reject or cancel_order."));
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

    // Cancelling the WHOLE order takes every live line, not just the batch
    // waiting for review -- the till is voiding the table's ticket, not
    // declining an addition.
    const targets =
      action === "cancel_order"
        ? (order.items || []).filter((i) => i.status !== "cancelled")
        : selectPendingItems(order, req.body?.itemIds);

    if (targets.length === 0) {
      return next(
        createHttpError(
          409,
          action === "cancel_order"
            ? "This order has nothing left to cancel."
            : "This order has no items waiting to be reviewed.",
        ),
      );
    }

    if (action === "accept") {
      targets.forEach((i) => { i.status = "preparing"; });
    } else {
      // Marked cancelled, NOT spliced out. Deleting the lines threw away the
      // `_id` the table session points at with `kdsItemId`, so the session --
      // which is what Manage Tables and the diner's own page read -- could
      // never be told which dish had gone. It also let a cancelled dish
      // vanish from the ticket with no record that it was ever ordered.
      const at = new Date();
      targets.forEach((i) => {
        i.status = "cancelled";
        i.cancelledAt = at;
        i.cancelReason = String(req.body?.reason || "").trim().slice(0, 200);
      });
    }

    // Keep the ticket total honest after either outcome.
    const live = (order.items || []).filter((i) => i.status !== "cancelled");
    const subtotal = live.reduce((s, i) => s + (Number(i.total) || 0), 0);
    if (order.bills) {
      const taxRate = Number(order.bills.subtotal) > 0
        ? Number(order.bills.tax || 0) / Number(order.bills.subtotal)
        : 0;
      order.bills.subtotal = subtotal;
      order.bills.tax = round2(subtotal * taxRate);
      order.bills.totalWithTax = round2(subtotal + order.bills.tax + Number(order.bills.charges || 0));
    }

    if (live.length === 0 && !isFinished(order.orderStatus)) {
      order.orderStatus = CANCELLED;
      order.readyDueAt = null;
      order.completeDueAt = null;
    }

    await order.save();

    // Voiding the whole ticket must free the table, like every other cancel
    // route. Without this Manage Tables kept the table occupied.
    if (action === "cancel_order") {
      try {
        const { releaseSessionForCancelledOrder } = require("./tableSessionController");
        await releaseSessionForCancelledOrder(order, req.user?.name || "POS");
      } catch (err) {
        console.warn("releaseSessionForCancelledOrder failed:", err.message);
      }
    }

    // Mirror onto the table session.
    //
    // This is the whole of the bug: the decision was written to the Order and
    // nowhere else. Manage Tables and the diner's phone both read the
    // SESSION, so a rejected dish stayed on the table's bill and on the
    // customer's screen forever -- the till saw it disappear from the ticket
    // and had no way to know the other two screens still showed it.
    const session = await syncSessionFromOrder(order, targets, action);

    try {
      emitOrderStatusChanged({
        restaurantId: order.restaurantId,
        outletId: order.outletId,
        order,
      });
      if (session) {
        emitTableSessionUpdated({
          restaurantId: order.restaurantId,
          outletId: order.outletId,
          tableId: order.table,
          session,
          reason: action,
        });
      }
    } catch (e) {
      console.warn("[onlineOrder] added-items emit failed:", e.message);
    }

    res.status(200).json({
      success: true,
      message:
        action === "accept"
          ? `${targets.length} added item(s) accepted.`
          : action === "cancel_order"
            ? "Order cancelled."
            : `${targets.length} added item(s) removed.`,
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
  listPrepDueOrders,
  listAwaitingOrders,
  startPreparingOrder,
  getOnlineOrderStats,
  toPosOrderView,
  ACTION_STATUS,
};
