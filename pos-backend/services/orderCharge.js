/**
 * KnotKitchen's per-order fee on orders paid online (website and table QR).
 *
 * Charged to the RESTAURANT, once, when a qualifying order is paid. Deducted
 * straight from the Business Balance -- there is no monthly accrual.
 *
 * One rule outranks everything here: **a billing problem must never stop a
 * restaurant taking money.** If the balance is short the order still goes
 * through and the fee is recorded as PENDING. KnotKitchen collects it when
 * the balance is topped up, or locks the account after the grace period --
 * it never refuses the diner.
 *
 * Qualifying is deliberately an allow-list, not a deny-list. `chargeableSources`
 * is configured in the admin panel and empty by default, so a new order source
 * added later cannot silently start billing every restaurant on the platform
 * simply by existing. The spec's exclusions -- cancelled, unpaid, POS -- fall
 * out of that rather than needing to be enumerated and kept in step.
 */

const Order = require("../models/orderModel");
const Restaurant = require("../models/restaurantModel");
const { isCancelled } = require("../constants/orderStatus");
const { REFUNDED_STATUSES } = require("../constants/orderStatus");
const { getPlatformConfig, resolveOrderCharge } = require("./pricing");
const { computeTax } = require("./tax");
const { debit, InsufficientBalanceError } = require("./ledger");
const { fireEvaluateLock } = require("./accountLock");

/** One key per order, so a retry from anywhere can never double-charge. */
const idempotencyKeyFor = (orderId) => `order-charge-${orderId}`;

const isPaid = (order) =>
  Array.isArray(order.payments) &&
  order.payments.some((p) => String(p?.status || "").toLowerCase() === "paid");

/**
 * Paid ONLINE, through the payment gateway: the only orders this fee is for.
 *
 * Every gateway settlement -- the website checkout, a table QR payment, a
 * payment link -- stamps the gateway's order id on the order in the same
 * write that marks it paid (storefrontController, tableSessionController,
 * paymentLinkSettlement). Cash, card at the counter, pay-at-pickup and a
 * manual "online"/UPI entry at the till never do, so they never qualify.
 */
const isPaidOnline = (order) => isPaid(order) && Boolean(order.paymentData?.gatewayOrderId);

const isRefunded = (order) =>
  REFUNDED_STATUSES.includes(String(order.orderStatus || ""));

/**
 * Should this order be charged, and if not, why not?
 *
 * The reason is stored on the order. "Why was I not billed for this one" is a
 * question the admin panel has to be able to answer without re-deriving the
 * rules from scratch.
 */
const no = (reason, permanent) => ({ ok: false, reason, permanent });

const qualifies = (order, charge, { anySource = false } = {}) => {
  // Permanent refusals are settled facts and get stamped on the order, so it
  // is never looked at again.
  if (!charge.enabled) {
    return no(
      charge.started === false
        ? "Order was placed before the per-order charge started."
        : "Per-order charge is not enabled.",
      true,
    );
  }
  if (!charge.amountPaise) return no("Charge is zero for this restaurant.", true);
  // A table bill is charged whatever each round's source (see chargeTableSession).
  if (!anySource && !charge.chargeableSources.includes(order.source)) {
    return no(`Order source ${order.source} is not chargeable.`, true);
  }
  if (isCancelled(order.orderStatus)) return no("Order was cancelled.", true);
  if (isRefunded(order)) return no("Order was refunded.", true);
  if (order.isDeleted) return no("Order was deleted.", true);

  // NOT permanent. A website order is created with its payment pending and
  // becomes paid later -- at checkout, on delivery, or through a gateway
  // callback. Stamping it now would exempt it from ever being charged.
  if (!isPaid(order)) return no("Order is not paid yet.", false);
  // Settled, but not through the gateway: a final answer.
  if (!isPaidOnline(order)) return no("Order was not paid online through the payment gateway.", true);

  return { ok: true };
};

/**
 * Charge one order. Safe to call repeatedly and from more than one place.
 *
 * Never throws for an insufficient balance -- that is an expected outcome
 * with its own status, not a fault.
 */
const chargeOrder = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) return { charged: false, reason: "Order not found." };

  // Already decided. The stamp is the guard, so an order settled twice (a
  // webhook redelivery, a manual retry) cannot be billed twice.
  if (order.platformCharge?.status) {
    return { charged: order.platformCharge.status === "PAID", already: true, order };
  }

  // A table order is billed per BILL, not per order, and only when the table
  // pays through the gateway (chargeTableSession). Charging a round here as
  // well could put a second ₹9 on the same bill, or bill a table settled in
  // cash whose orders still carry an abandoned online checkout's gateway id.
  // Not stamped: the gateway settle decides.
  if (order.tableSessionId) {
    return { charged: false, reason: "Table orders are charged once per bill, when the table pays online.", order };
  }

  const config = await getPlatformConfig();
  // Dated by when the order was PLACED, so an order taken before the start
  // date is never billed because it happened to settle after it.
  const charge = await resolveOrderCharge({
    restaurantId: order.restaurantId,
    on: order.createdAt || new Date(),
    config,
  });

  const verdict = qualifies(order, charge);
  if (!verdict.ok) {
    // Only record a refusal that can never change. An unpaid order is left
    // unstamped so the next settle attempt re-evaluates it.
    if (verdict.permanent) {
      order.platformCharge = { status: "NOT_APPLICABLE", reason: verdict.reason };
      await order.save();
    }
    return { charged: false, reason: verdict.reason, pendingPayment: !verdict.permanent, order };
  }

  return applyCharge(order, charge, config);
};

/** Debit the fee for one order and stamp the outcome on it. */
const applyCharge = async (order, charge, config) => {
  const restaurant = await Restaurant.findById(order.restaurantId).select("address").lean();
  const tax = charge.taxable
    ? computeTax({
        amountPaise: charge.amountPaise,
        gst: config.gst,
        restaurantState: restaurant?.address?.state,
        // Always tax-exclusive: GST goes on top, like the plan lines. Only
        // printer lines are GST-inclusive; gst.mode is not consulted.
        mode: "exclusive",
      })
    : { totalTaxPaise: 0, totalPaise: charge.amountPaise, percent: 0 };

  const stamp = {
    amountPaise: charge.amountPaise,
    taxPaise: tax.totalTaxPaise,
    totalPaise: tax.totalPaise,
    taxPercent: tax.percent || 0,
    chargedAt: new Date(),
  };

  try {
    const { entry } = await debit({
      restaurantId: order.restaurantId,
      kind: "ORDER_CHARGE",
      amountPaise: tax.totalPaise,
      description: `Online order charge — #${order.orderNumber || order._id}`,
      idempotencyKey: idempotencyKeyFor(order._id),
      refType: "Order",
      refId: order._id,
      meta: { orderNumber: order.orderNumber, source: order.source },
    });

    order.platformCharge = { ...stamp, status: "PAID", ledgerEntryId: entry._id };
    await order.save();
    return { charged: true, order, entry };
  } catch (err) {
    if (!(err instanceof InsufficientBalanceError)) throw err;

    // Owed, not lost. The diner's order is already done; this is between
    // KnotKitchen and the restaurant.
    order.platformCharge = {
      ...stamp,
      status: "PENDING",
      reason: "Insufficient Business Balance at the time of the order.",
    };
    await order.save();
    // The clock on the grace period starts here.
    fireEvaluateLock(order.restaurantId);
    return { charged: false, pending: true, order, shortfallPaise: err.requiredPaise };
  }
};

/** Fire-and-forget, for settle paths that must not be delayed or broken by billing. */
const fireOrderCharge = (orderId) => {
  chargeOrder(orderId).catch((err) => {
    console.warn("[OrderCharge] failed:", err && err.message);
  });
};

/**
 * A table bill paid through the gateway is ONE online payment, so it is
 * charged once: however many rounds the table ordered, and whether each round
 * was punched at the till (POS) or ordered from the QR. The fee sits on the
 * session's earliest live order; every other order points at it.
 *
 * Only settleSessionFromGateway calls this. A table settled in cash or at the
 * counter never reaches it, so it is never charged.
 *
 * Safe to repeat. A charge already on any order of the session (PAID or
 * PENDING) is the answer; otherwise the target is chosen deterministically
 * (oldest first) and debited under its own per-order key, so a browser and a
 * webhook settling at once pick the same order and the ledger keeps one.
 */
const chargeTableSession = async (sessionId) => {
  const orders = await Order.find({ tableSessionId: sessionId, isDeleted: { $ne: true } })
    .sort({ createdAt: 1, _id: 1 });
  const live = orders.filter((o) => !isCancelled(o.orderStatus) && !isRefunded(o));
  if (!live.length) return { charged: false, reason: "No live order on this table bill." };

  let target = orders.find((o) => ["PAID", "PENDING"].includes(o.platformCharge?.status));
  let result;
  if (target) {
    result = { charged: target.platformCharge.status === "PAID", already: true, order: target };
  } else {
    target = live[0];
    const config = await getPlatformConfig();
    const charge = await resolveOrderCharge({
      restaurantId: target.restaurantId,
      on: target.createdAt || new Date(),
      config,
    });
    const verdict = qualifies(target, charge, { anySource: true });
    if (verdict.ok) {
      result = await applyCharge(target, charge, config);
    } else if (!verdict.permanent) {
      // Not paid yet (should not happen after a settle): stamp nothing, so a
      // later settle can still decide.
      return { charged: false, reason: verdict.reason, pendingPayment: true, order: target };
    } else {
      // The bill is settled, so the answer is final either way. A stamp from an
      // earlier per-order look (e.g. "source POS is not chargeable") is replaced.
      target.platformCharge = { status: "NOT_APPLICABLE", reason: verdict.reason };
      await target.save();
      result = { charged: false, reason: verdict.reason, order: target };
    }
  }

  const reason = ["PAID", "PENDING"].includes(target.platformCharge?.status)
    ? tableChargeReason(target._id)
    : target.platformCharge?.reason;
  for (const o of orders) {
    if (String(o._id) === String(target._id)) continue;
    if (o.platformCharge?.status === "NOT_APPLICABLE" && o.platformCharge.reason === reason) continue;
    o.platformCharge = { status: "NOT_APPLICABLE", reason };
    await o.save();
  }
  return result;
};

const tableChargeReason = (orderId) => `Table bill charged once (order ${orderId})`;

/** Fire-and-forget: a table settle must not be delayed or broken by billing. */
const fireTableSessionCharge = (sessionId) => {
  chargeTableSession(sessionId).catch((err) => {
    console.warn("[OrderCharge] table bill failed:", err && err.message);
  });
};

/** What a restaurant currently owes in unpaid per-order fees. */
const outstandingDues = async (restaurantId) => {
  const rows = await Order.find({
    restaurantId,
    "platformCharge.status": "PENDING",
  })
    .select("orderNumber platformCharge createdAt")
    .sort({ "platformCharge.chargedAt": 1 })
    .lean();

  return {
    count: rows.length,
    totalPaise: rows.reduce((n, o) => n + Number(o.platformCharge?.totalPaise || 0), 0),
    oldestAt: rows.length ? rows[0].platformCharge?.chargedAt || rows[0].createdAt : null,
    orders: rows,
  };
};

/**
 * Collect what is owed, oldest first, until the balance runs out again.
 *
 * Called after a top-up. Stops at the first shortfall rather than skipping
 * ahead to a cheaper one, so dues are always cleared in the order they were
 * incurred.
 */
const settlePendingCharges = async (restaurantId) => {
  const { orders } = await outstandingDues(restaurantId);
  const settled = [];

  for (const row of orders) {
    const order = await Order.findById(row._id);
    if (!order || order.platformCharge?.status !== "PENDING") continue;

    try {
      const { entry } = await debit({
        restaurantId,
        kind: "ORDER_CHARGE",
        amountPaise: order.platformCharge.totalPaise,
        description: `Online order charge — #${order.orderNumber || order._id}`,
        idempotencyKey: idempotencyKeyFor(order._id),
        refType: "Order",
        refId: order._id,
        meta: { orderNumber: order.orderNumber, settledLate: true },
      });

      order.platformCharge.status = "PAID";
      order.platformCharge.reason = "";
      order.platformCharge.ledgerEntryId = entry._id;
      await order.save();
      settled.push(order._id);
    } catch (err) {
      if (err instanceof InsufficientBalanceError) break;
      throw err;
    }
  }

  // Paying off dues may be exactly what clears a lock.
  fireEvaluateLock(restaurantId);
  return { settled: settled.length, remaining: (await outstandingDues(restaurantId)).count };
};

module.exports = {
  chargeOrder,
  fireOrderCharge,
  chargeTableSession,
  fireTableSessionCharge,
  tableChargeReason,
  settlePendingCharges,
  outstandingDues,
  qualifies,
  isPaidOnline,
  idempotencyKeyFor,
};
