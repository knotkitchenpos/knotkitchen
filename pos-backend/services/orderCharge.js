/**
 * KnotKitchen's platform fee on orders paid online (website and table QR).
 *
 * The DINER pays it, as a visible "Platform fee" (+GST) line on top of the
 * bill, and only when paying online: a website checkout or a table-QR gateway
 * payment. The money lands in the restaurant's gateway account with the bill,
 * so the same amount is then debited from the restaurant's wallet.
 *
 * The fee is quoted ONCE, when the diner is about to pay (quotePlatformFee),
 * and that snapshot is stored on the order or table session. The debit is
 * exactly the snapshot -- never a rate looked up again later -- so what the
 * wallet loses always equals what the diner paid, whatever CSD changes in
 * between. Anything without a snapshot (cash, counter, payment links, orders
 * from before this) carried no fee and is never debited.
 *
 * One rule outranks everything here: **a billing problem must never stop a
 * restaurant taking money.** If the balance is short the order still goes
 * through and the fee is recorded as PENDING. KnotKitchen collects it when
 * the balance is topped up, or locks the account after the grace period --
 * it never refuses the diner.
 */

const Order = require("../models/orderModel");
const Restaurant = require("../models/restaurantModel");
const TableSession = require("../models/tableSessionModel");
const { isCancelled } = require("../constants/orderStatus");
const { REFUNDED_STATUSES } = require("../constants/orderStatus");
const { getPlatformConfig, resolveOrderCharge } = require("./pricing");
const { computeTax } = require("./tax");
const { debit, credit, findByIdempotencyKey, InsufficientBalanceError } = require("./ledger");
const { fireEvaluateLock } = require("./accountLock");

/** One key per order, so a retry from anywhere can never double-charge. */
const idempotencyKeyFor = (orderId) => `order-charge-${orderId}`;

/**
 * The wallet debit this order's fee was really taken by, or null. The ledger
 * is the only proof: a "PAID" stamp on an order is just a field on a document
 * a client may once have written.
 */
const debitFor = async (order) => {
  const entry = await findByIdempotencyKey(idempotencyKeyFor(order._id));
  const real = entry && entry.direction === "DEBIT" && entry.kind === "ORDER_CHARGE"
    && String(entry.restaurantId) === String(order.restaurantId);
  return real ? entry : null;
};

const NO_FEE = "No platform fee was collected.";

/** Just the amounts of a fee snapshot, from a subdocument or a plain object. */
const feeOf = (pc) => ({
  amountPaise: Number(pc?.amountPaise) || 0,
  taxPaise: Number(pc?.taxPaise) || 0,
  totalPaise: Number(pc?.totalPaise) || 0,
  taxPercent: Number(pc?.taxPercent) || 0,
});

/**
 * The platform fee a diner is about to pay online, or null when there is none
 * (switched off, not started for this store, zero, a demo store, or a source
 * that carries no fee).
 *
 * GST always goes on top (exclusive), like the plan lines, and is 0 until
 * KnotKitchen's own GST registration is effective. The result is what gets
 * stored on the order or session and later debited, unchanged.
 */
const quotePlatformFee = async ({ restaurantId, source, on = new Date() } = {}) => {
  const config = await getPlatformConfig();
  const charge = await resolveOrderCharge({ restaurantId, source, on, config });
  if (!charge.enabled || !(charge.amountPaise > 0)) return null;

  const restaurant = await Restaurant.findById(restaurantId).select("address").lean();
  const tax = charge.taxable
    ? computeTax({
        amountPaise: charge.amountPaise,
        gst: config.gst,
        restaurantState: restaurant?.address?.state,
        on,
        // Always tax-exclusive: GST goes on top, like the plan lines. Only
        // printer lines are GST-inclusive; gst.mode is not consulted.
        mode: "exclusive",
      })
    : { totalTaxPaise: 0, totalPaise: charge.amountPaise, percent: 0 };

  return {
    amountPaise: charge.amountPaise,
    taxPaise: tax.totalTaxPaise || 0,
    totalPaise: tax.totalPaise,
    taxPercent: tax.percent || 0,
  };
};

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

const qualifies = (order) => {
  // Permanent refusals are settled facts and get stamped on the order, so it
  // is never looked at again.
  //
  // Whether there is a fee at all (switched on, started, its amount, the
  // source) was decided once, when it was quoted to the diner at checkout.
  // No snapshot means the diner paid no fee, so there is nothing to debit.
  if (!(feeOf(order.platformCharge).totalPaise > 0)) return no(NO_FEE, true);
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
 * Charge one order. Safe to call repeatedly and from more than one place:
 * a website order is debited when its payment is confirmed
 * (placePaidCheckout), and the completion-time calls are retries.
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
  // pays through the gateway (chargeTableSession), from the fee stored on the
  // session. Not stamped: the gateway settle decides.
  if (order.tableSessionId) {
    return { charged: false, reason: "Table orders are charged once per bill, when the table pays online.", order };
  }

  const verdict = qualifies(order);
  if (!verdict.ok) {
    // Only record a refusal that can never change. An unpaid order is left
    // unstamped so the next settle attempt re-evaluates it.
    if (verdict.permanent) {
      order.platformCharge = { ...feeOf(order.platformCharge), status: "NOT_APPLICABLE", reason: verdict.reason };
      await order.save();
    }
    return { charged: false, reason: verdict.reason, pendingPayment: !verdict.permanent, order };
  }

  return applyCharge(order);
};

/** Debit the order's fee snapshot and stamp the outcome on it. */
const applyCharge = async (order) => {
  const stamp = { ...feeOf(order.platformCharge), chargedAt: new Date() };

  try {
    const { entry } = await debit({
      restaurantId: order.restaurantId,
      kind: "ORDER_CHARGE",
      amountPaise: stamp.totalPaise,
      description: `Platform fee — #${order.orderNumber || order._id}`,
      idempotencyKey: idempotencyKeyFor(order._id),
      refType: "Order",
      refId: order._id,
      meta: { orderNumber: order.orderNumber, source: order.source },
    });

    order.platformCharge = { ...stamp, status: "PAID", reason: "", ledgerEntryId: entry._id };
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
 * was punched at the till (POS) or ordered from the QR. The fee is the one the
 * diner paid, stored on the session when the payment was opened; it is copied
 * onto the session's earliest live order, and every other order points at it.
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

  // A PAID stamp counts only with the ledger debit behind it.
  let target = null;
  for (const o of orders) {
    const pc = o.platformCharge;
    if (pc?.status === "PENDING") target = o;
    else if (pc?.status === "PAID" && pc.ledgerEntryId) {
      const entry = await debitFor(o);
      if (entry && String(entry._id) === String(pc.ledgerEntryId)) target = o;
    }
    if (target) break;
  }
  let result;
  if (target) {
    result = { charged: target.platformCharge.status === "PAID", already: true, order: target };
  } else {
    target = live[0];
    const session = await TableSession.findById(sessionId).select("payment.platformFee").lean();
    // The bill's own fee decides, replacing any earlier per-order stamp.
    target.platformCharge = feeOf(session?.payment?.platformFee);
    const verdict = qualifies(target);
    if (verdict.ok) {
      result = await applyCharge(target);
    } else if (!verdict.permanent) {
      // Not paid yet (should not happen after a settle): stamp nothing, so a
      // later settle can still decide.
      return { charged: false, reason: verdict.reason, pendingPayment: true, order: target };
    } else {
      // The bill is settled, so the answer is final either way.
      target.platformCharge = { ...feeOf(target.platformCharge), status: "NOT_APPLICABLE", reason: verdict.reason };
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

/** What a restaurant currently owes in unpaid platform fees. */
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
    // A cancel whose reversal never ran (a crash, a race) must not have its
    // fee collected later.
    if (isCancelled(order.orderStatus) || isRefunded(order) || order.isDeleted) {
      order.platformCharge.status = "WAIVED";
      order.platformCharge.reason = "Order cancelled, refunded or deleted; platform fee waived.";
      await order.save();
      continue;
    }

    try {
      const { entry } = await debit({
        restaurantId,
        kind: "ORDER_CHARGE",
        amountPaise: order.platformCharge.totalPaise,
        description: `Platform fee — #${order.orderNumber || order._id}`,
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

/**
 * An order holding the fee was cancelled, rejected or voided: give the fee
 * back. A debited fee is credited to the wallet (the diner's own refund
 * already includes it, because refunds sum the payments); one still owed is
 * waived, so it is never collected. Safe to repeat: the WAIVED stamp and the
 * ledger key each stop a second credit.
 *
 * What is credited is the ledger's own debit for this order, never the amount
 * the order claims: no debit, no credit, whatever the stamp says.
 *
 * ponytail: only the order holding the fee reverses it; voiding one round of
 * a multi-round table bill whose fee sits on another round returns nothing.
 */
const reverseOrderCharge = async (orderId) => {
  const order = await Order.findById(orderId);
  const status = order?.platformCharge?.status;
  if (status !== "PAID" && status !== "PENDING") return { reversed: false };

  const paid = await debitFor(order);
  if (paid) {
    await credit({
      restaurantId: order.restaurantId,
      kind: "REFUND",
      amountPaise: paid.amountPaise,
      description: `Platform fee returned — #${order.orderNumber || order._id}`,
      idempotencyKey: `order-charge-reversal-${order._id}`,
      refType: "Order",
      refId: order._id,
      meta: { orderNumber: order.orderNumber },
    });
  }
  order.platformCharge.status = "WAIVED";
  order.platformCharge.reason = paid ? "Order cancelled; platform fee returned." : "Order cancelled; platform fee waived.";
  await order.save();
  // Money back may pay other dues, and a waived due may be what clears a lock.
  await settlePendingCharges(order.restaurantId);
  return { reversed: true, credited: Boolean(paid) };
};

/** Fire-and-forget: a cancel must not be delayed or broken by billing. */
const fireOrderChargeReversal = (orderId) => {
  reverseOrderCharge(orderId).catch((err) => {
    console.warn("[OrderCharge] reversal failed:", err && err.message);
  });
};

module.exports = {
  quotePlatformFee,
  chargeOrder,
  fireOrderCharge,
  chargeTableSession,
  fireTableSessionCharge,
  tableChargeReason,
  reverseOrderCharge,
  fireOrderChargeReversal,
  settlePendingCharges,
  outstandingDues,
  qualifies,
  isPaidOnline,
  idempotencyKeyFor,
};
